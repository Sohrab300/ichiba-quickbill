-- Migration: Initialize Ichiba POS Schema and complete_sale RPC

-- 1. Helper Function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Products Table
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barcode TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0), -- Stored in paise (₹1 = 100 paise)
    category TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger for products.updated_at
DROP TRIGGER IF EXISTS trigger_products_updated_at ON products;
CREATE TRIGGER trigger_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 3. Sales Table
CREATE TABLE IF NOT EXISTS sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subtotal INTEGER NOT NULL DEFAULT 0, -- Stored in paise
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Sale Items Table
CREATE TABLE IF NOT EXISTS sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL, -- Snapshot of product name at sale time
    unit_price INTEGER NOT NULL, -- Snapshot of product unit price in paise at sale time
    quantity INTEGER NOT NULL CHECK (quantity > 0)
);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sales_created_at_desc ON sales(created_at DESC);

-- 6. Enable Row Level Security (RLS) on all tables with NO public policies
-- (Service role key bypasses RLS; anon/authenticated roles have no direct table access)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

-- 7. complete_sale RPC function
-- Atomically creates a sale, snapshots product names and prices directly from DB,
-- creates line items, computes final subtotal on the server, and returns the sale UUID.
CREATE OR REPLACE FUNCTION complete_sale(items JSONB)
RETURNS UUID AS $$
DECLARE
    new_sale_id UUID;
    computed_subtotal INTEGER := 0;
    item_record JSONB;
    item_product_id UUID;
    item_qty INTEGER;
    p_name TEXT;
    p_price INTEGER;
    line_subtotal INTEGER;
BEGIN
    -- Validate items parameter
    IF items IS NULL OR jsonb_typeof(items) <> 'array' OR jsonb_array_length(items) = 0 THEN
        RAISE EXCEPTION 'Sale items array cannot be empty';
    END IF;

    -- Create empty sale row
    INSERT INTO sales (subtotal) VALUES (0) RETURNING id INTO new_sale_id;

    -- Loop over items, look up DB prices, and insert snapshot rows
    FOR item_record IN SELECT * FROM jsonb_array_elements(items)
    LOOP
        item_product_id := (item_record->>'product_id')::UUID;
        item_qty := (item_record->>'quantity')::INTEGER;

        IF item_product_id IS NULL THEN
            RAISE EXCEPTION 'product_id is required for all sale items';
        END IF;

        IF item_qty IS NULL OR item_qty <= 0 THEN
            RAISE EXCEPTION 'quantity must be positive for product %', item_product_id;
        END IF;

        -- Retrieve current price and name directly from DB to prevent tampering
        SELECT name, price INTO p_name, p_price
        FROM products
        WHERE id = item_product_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product with id % not found', item_product_id;
        END IF;

        line_subtotal := p_price * item_qty;
        computed_subtotal := computed_subtotal + line_subtotal;

        INSERT INTO sale_items (sale_id, product_id, product_name, unit_price, quantity)
        VALUES (new_sale_id, item_product_id, p_name, p_price, item_qty);
    END LOOP;

    -- Update final computed subtotal
    UPDATE sales SET subtotal = computed_subtotal WHERE id = new_sale_id;

    RETURN new_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke execute from public/anon/authenticated and grant strictly to service_role
REVOKE ALL ON FUNCTION complete_sale(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION complete_sale(JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION complete_sale(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION complete_sale(JSONB) TO service_role;
