/** GST slabs accepted by products.gst_rate (DB check constraint products_gst_rate_valid). */
export const GST_RATES = [0, 5, 12, 18, 28, 40] as const;
export type GstRate = (typeof GST_RATES)[number];
