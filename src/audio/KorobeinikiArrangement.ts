/*
 * コロベイニキ（Korobeiniki / Коробейники）— 19世紀ロシア民謡の旋律をモチーフにした独自アレンジ。
 * 既存のゲーム音源・録音・アレンジは一切使用せず、音符データと Web Audio の合成音だけで構成する。
 * グリッドは8分音符（1 step）。
 */

export type Voice = 'lead' | 'lead2' | 'harm' | 'bass' | 'arp' | 'kick' | 'snare' | 'hat';

export interface NoteEvent {
  voice: Voice;
  midi: number;
  /** 長さ（step 数） */
  len: number;
  vel: number;
}

export interface Song {
  length: number;
  byStep: NoteEvent[][];
  baseBpm: number;
}

type Phrase = Array<[note: string | null, len: number]>;

const A_MELODY: Phrase = [
  ['E5', 2], ['B4', 1], ['C5', 1], ['D5', 2], ['C5', 1], ['B4', 1],
  ['A4', 2], ['A4', 1], ['C5', 1], ['E5', 2], ['D5', 1], ['C5', 1],
  ['B4', 3], ['C5', 1], ['D5', 2], ['E5', 2],
  ['C5', 2], ['A4', 2], ['A4', 2], [null, 2],
  [null, 1], ['D5', 2], ['F5', 1], ['A5', 2], ['G5', 1], ['F5', 1],
  ['E5', 3], ['C5', 1], ['E5', 2], ['D5', 1], ['C5', 1],
  ['B4', 2], ['B4', 1], ['C5', 1], ['D5', 2], ['E5', 2],
  ['C5', 2], ['A4', 2], ['A4', 2], [null, 2],
];

const B_MELODY: Phrase = [
  ['E5', 4], ['C5', 4], ['D5', 4], ['B4', 4],
  ['C5', 4], ['A4', 4], ['G#4', 4], ['B4', 4],
  ['E5', 4], ['C5', 4], ['D5', 4], ['B4', 4],
  ['C5', 2], ['E5', 2], ['A5', 4], ['G#5', 8],
];

type Chord = 'Am' | 'E' | 'Dm' | 'C';
const A_CHORDS: Chord[] = ['E', 'Am', 'E', 'Am', 'Dm', 'C', 'E', 'Am'];
const B_CHORDS: Chord[] = ['Am', 'E', 'Am', 'E', 'Am', 'E', 'Am', 'E'];
const BASS_ROOT: Record<Chord, number> = { Am: 45, E: 40, Dm: 38, C: 36 };
const CHORD_TONES: Record<Chord, number[]> = {
  Am: [69, 72, 76],
  E: [68, 71, 76],
  Dm: [69, 74, 77],
  C: [67, 72, 76],
};

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function noteToMidi(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + NOTE_INDEX[m[1]] + acc;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

type SectionKind = 'A1' | 'A2' | 'B';

export function buildKorobeiniki(): Song {
  const form: SectionKind[] = ['A1', 'A2', 'B', 'A2'];
  const sectionLen = 64;
  const length = form.length * sectionLen;
  const byStep: NoteEvent[][] = Array.from({ length }, () => []);
  const add = (step: number, ev: NoteEvent) => byStep[step % length].push(ev);

  form.forEach((kind, si) => {
    const start = si * sectionLen;
    const melody = kind === 'B' ? B_MELODY : A_MELODY;
    const chords = kind === 'B' ? B_CHORDS : A_CHORDS;

    // メロディ（A2 はパルス波に変えて1オクターブ下のハーモニーを重ねる）
    let t = start;
    for (const [note, len] of melody) {
      if (note) {
        const midi = noteToMidi(note);
        add(t, { voice: kind === 'A2' ? 'lead2' : 'lead', midi, len, vel: 0.9 });
        if (kind !== 'A1') add(t, { voice: 'harm', midi: midi - 12, len, vel: kind === 'B' ? 0.5 : 0.4 });
      }
      t += len;
    }

    chords.forEach((chord, bar) => {
      const b = start + bar * 8;
      const root = BASS_ROOT[chord];
      if (kind === 'B') {
        // 四分音符でルート→5度→オクターブ→5度、上にアルペジオ
        [0, 7, 12, 7].forEach((iv, i) => add(b + i * 2, { voice: 'bass', midi: root + iv, len: 2, vel: 0.8 }));
        const tones = CHORD_TONES[chord];
        [0, 1, 2, 1, 0, 1, 2, 1].forEach((ti, i) => add(b + i, { voice: 'arp', midi: tones[ti], len: 1, vel: 0.35 }));
        add(b, { voice: 'kick', midi: 0, len: 1, vel: 0.8 });
        [2, 4, 6].forEach((s) => add(b + s, { voice: 'hat', midi: 0, len: 1, vel: 0.35 }));
        if (bar % 2 === 1) add(b + 6, { voice: 'snare', midi: 0, len: 1, vel: 0.5 });
      } else {
        // 8分でオクターブ跳躍するベース
        for (let i = 0; i < 8; i++) add(b + i, { voice: 'bass', midi: root + (i % 2 === 0 ? 0 : 12), len: 1, vel: 0.85 });
        [0, 4].forEach((s) => add(b + s, { voice: 'kick', midi: 0, len: 1, vel: 1 }));
        [2, 6].forEach((s) => add(b + s, { voice: 'snare', midi: 0, len: 1, vel: 0.7 }));
        [1, 3, 5, 7].forEach((s) => add(b + s, { voice: 'hat', midi: 0, len: 1, vel: kind === 'A2' ? 0.55 : 0.4 }));
      }
    });
  });

  return { length, byStep, baseBpm: 150 };
}
