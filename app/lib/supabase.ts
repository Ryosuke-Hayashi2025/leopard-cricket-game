import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase = url && key ? createClient(url, key) : null;

export type ResultType = "clear" | "gameover";
export type Difficulty = "normal" | "hard";

export async function logPlay(difficulty: Difficulty, result: ResultType, score: number) {
  if (!supabase) return;
  await supabase.from("leopa_cricket_game_plays").insert({ difficulty, result, score });
}

export async function fetchStats(): Promise<{
  normalTotal: number; normalClear: number; normalTopScore: number;
  hardTotal:   number; hardClear:   number; hardTopScore:   number;
}> {
  const empty = { normalTotal: 0, normalClear: 0, normalTopScore: 0,
                  hardTotal:   0, hardClear:   0, hardTopScore:   0 };
  if (!supabase) return empty;
  const { data } = await supabase
    .from("leopa_cricket_game_plays")
    .select("difficulty, result, score");
  if (!data) return empty;

  const normal = data.filter((r) => r.difficulty === "normal");
  const hard   = data.filter((r) => r.difficulty === "hard");
  return {
    normalTotal:    normal.length,
    normalClear:    normal.filter((r) => r.result === "clear").length,
    normalTopScore: Math.max(0, ...normal.map((r) => r.score ?? 0)),
    hardTotal:      hard.length,
    hardClear:      hard.filter((r) => r.result === "clear").length,
    hardTopScore:   Math.max(0, ...hard.map((r) => r.score ?? 0)),
  };
}
