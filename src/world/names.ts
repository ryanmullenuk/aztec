/**
 * Island names in the style of Nahuatl place names: a root (water, flower, star, eagle, jade…)
 * joined to a place ending (-tlan "place of plenty", -tepec "on the hill", -co "in", -pan "upon",
 * -apan "by the water", -milco "in the fields"…), like Xochitepec, Citlaltepec or Cuauhtitlan.
 */

/** Roots ending in a vowel, and roots ending in a consonant (they take different endings). */
const ROOTS_V = ['Xochi', 'Tepe', 'Coa', 'Aca', 'Tona', 'Ayo', 'Maza', 'Tochi', 'Chalchiu', 'Ilhui', 'Teo', 'Quetza', 'Oce', 'Tlalo', 'Iztaca', 'Mixco', 'Ehe', 'Tenoch', 'Huitzi', 'Popoca'];
const ROOTS_C = ['Citlal', 'Cuauh', 'Atl', 'Metz', 'Tecpatl', 'Iztac', 'Ocotl', 'Tollan'];
const END_V = ['tlan', 'pan', 'can', 'tepec', 'co', 'apan', 'milco', 'huacan', 'zinco', 'titlan', 'lco'];
const END_C = ['tepec', 'titlan', 'ixco', 'apan', 'ihuacan', 'ico'];
/** A few real and legendary names mixed in. */
const CLASSIC = ['Tlalocan', 'Tamoanchan', 'Aztlan', 'Xochitepec', 'Citlaltepec', 'Cuauhtitlan', 'Tepoztlan', 'Coatlan', 'Atlixco', 'Chalchiuhtlan', 'Tonalan', 'Xochimilco'];

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function randomIslandName(rnd: () => number = Math.random): string {
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  if (rnd() < 0.2) return pick(CLASSIC);
  const consonant = rnd() < 0.3;
  let name = consonant ? pick(ROOTS_C) + pick(END_C) : pick(ROOTS_V) + pick(END_V);
  // Tidy awkward joins (double letters across the seam).
  name = name.replace(/([aeiou])\1/g, '$1').replace(/tt/g, 't').replace(/hh/g, 'h');
  return cap(name.toLowerCase());
}

/** The secret test name: infinite resources. */
export const GOD_NAME = 'GODMODE';
