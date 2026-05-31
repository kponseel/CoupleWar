import { randomBytes, randomInt } from "node:crypto";

/** Alphabet sans voyelles pour éviter les mots involontaires (§4.1). */
const ROOM_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

export function makeRoomCode(length: number): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
  }
  return code;
}

/** Mini-code à 2 chiffres pour rejoindre un couple (§4.2). */
export function makeCoupleJoinCode(): string {
  return String(randomInt(10, 100)); // 10..99
}

export function makeId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}
