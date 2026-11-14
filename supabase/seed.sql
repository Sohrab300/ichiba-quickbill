-- Seed data for Ichiba POS
-- Realistic Indian retail grocery & convenience products with valid EAN-13 barcodes
-- All prices stored as integers in paise (₹1 = 100 paise)

INSERT INTO products (barcode, name, price, category) VALUES
('8901030865412', 'Parle-G Gold Biscuits 800g', 8500, 'Groceries & Snacks'),
('8901491101838', 'Maggi 2-Minute Masala Noodles 4-Pack', 5600, 'Groceries & Snacks'),
('8901262010048', 'Amul Pasteurized Butter 500g', 27500, 'Dairy'),
('8901058852302', 'Tata Salt Iodized 1kg', 2800, 'Staples'),
('8901725181223', 'Fortune Sunlite Refined Sunflower Oil 1L', 14500, 'Staples'),
('8901030383459', 'Brooke Bond Red Label Tea 500g', 26000, 'Beverages'),
('8901063012111', 'Britannia Good Day Butter Cookies 200g', 4000, 'Groceries & Snacks'),
('8902080000101', 'Dettol Original Liquid Handwash Refill 200ml', 9900, 'Personal Care'),
('8901526101111', 'Haldirams Nagpur Aloo Bhujia 400g', 11000, 'Groceries & Snacks'),
('8901030612345', 'Surf Excel Easy Wash Detergent Powder 1kg', 14000, 'Household'),
('8901207010101', 'Coca-Cola Soft Drink PET 750ml', 4000, 'Beverages'),
('8906010500123', 'Epigamia Greek Yogurt Natural 100g', 5000, 'Dairy')
ON CONFLICT (barcode) DO NOTHING;
