/**
 * Café public-surface details (B6). Static, no API key. The map link is pinned
 * to the place (query_place_id) and centred on its coordinates. Contact is a
 * placeholder mailto until a real address is provided (no contact form / spam
 * surface).
 */

export const cafeName = 'Ckyka Specialty Coffee Shop';
export const cafeAddress = 'ul. "Oborishte" 89, Oborishte, 1505 Sofia, Bulgaria';

/** Opens the place centred in Google Maps (coords + Place ID pin). */
export const cafeMapUrl =
  'https://www.google.com/maps/search/?api=1&query=42.693861%2C23.349611&query_place_id=ChIJk_kwFsWFqkARDZkg8CtQ2mA';

/**
 * Embeddable map centred on the shop's coordinates. Uses the keyless classic
 * embed (`output=embed`) so no Google Maps API key is needed in the prototype.
 */
export const cafeMapEmbedUrl =
  'https://maps.google.com/maps?q=42.693861,23.349611&z=16&hl=en&output=embed';

/** The café's contact address ("Contact us" mailto target). */
export const cafeContactEmail = 'ckykacafe@gmail.com';

/** Instagram handle + profile link (universal link opens the app on mobile). */
export const cafeInstagramHandle = 'ckykacoffeeshop';
export const cafeInstagramUrl = 'https://www.instagram.com/ckykacoffeeshop/';
