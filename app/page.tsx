"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { logPlay, fetchStats, type ResultType, type Difficulty } from "./lib/supabase";

// ============================================================
// 定数
// ============================================================
const CANVAS_W = 400;
const CANVAS_H = 640;
const CRICKET_COUNT = 5;

// ===== 難易度設定 =====
const DIFFICULTY_CONFIG: Record<Difficulty, {
  gameDuration: number;
  escapeFloor: number;
  speedMult: number;
  tapRadius: number;
}> = {
  normal: { gameDuration: 30, escapeFloor: 0.00, speedMult: 1.0, tapRadius: 60 },
  hard:   { gameDuration: 15, escapeFloor: 0.00, speedMult: 2.5, tapRadius: 60 },
};
const GROUND_Y = 550;
const LEOPA_BASE_X = 40;
const LEOPA_W = 112;
const LEOPA_H = 112;
const CRICKET_W = 72;
const CRICKET_H = 72;


// ============================================================
// 型定義
// ============================================================
type LeopaState = "idle" | "crouch" | "jump" | "eat" | "miss";

// ============================================================
// 画像ファイルパス定義（差し替えはここだけ）
// 画像がなければフォールバック描画を使用
// ============================================================
const IMG_LEOPA: Record<LeopaState, string> = {
  idle:   "/images/leopa-idle.png",
  crouch: "/images/leopa-crouch.png",
  jump:   "/images/leopa-jump.png",
  eat:    "/images/leopa-eat.png",
  miss:   "/images/leopa-miss.png",
};

const IMG_CRICKET = "/images/cricket.png";

const IMG_NANDEYANEN = "/images/nandeyanen.png";

interface Cricket {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  animFrame: number;
  animTimer: number;
  dirTimer: number;
  alive: boolean;
}

interface GameRef {
  leopa: {
    state: LeopaState;
    stateTimer: number;
    jumpFromX: number;
    jumpFromY: number;
    jumpX: number;
    jumpY: number;
    jumpToX: number;
    jumpToY: number;
    jumpProgress: number;
    collisionChecked: boolean;
    hadHit: boolean;
    facingLeft: boolean;
    targetId: number;
  };
  crickets: Cricket[];
  shake: { intensity: number; duration: number };
  nandeyanen: { visible: boolean; timer: number; burst: boolean };
  hitPopup: { visible: boolean; timer: number; label: string; x: number; y: number };
  score: number;
  catchScore: number;
  timeBonus: number;
  combo: number;
  maxCombo: number;
  tapPrecision: number;
  timeLeft: number;
  running: boolean;
  resultType: ResultType;
  difficulty: Difficulty;
}

// ============================================================
// ヘルパー関数
// ============================================================
let _cricketId = 0;

function spawnCricket(): Cricket {
  const minX = 60;
  const maxX = CANVAS_W - CRICKET_W - 20;
  const minY = 40;
  const maxY = GROUND_Y - CRICKET_H - 4;
  return {
    id: _cricketId++,
    x: minX + Math.random() * (maxX - minX),
    y: minY + Math.random() * (maxY - minY),
    vx: (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 80),
    vy: (Math.random() - 0.5) * 50,
    animFrame: Math.floor(Math.random() * 6),
    animTimer: 0,
    dirTimer: 0.4 + Math.random() * 0.8,
    alive: true,
  };
}

// ============================================================
// プレースホルダー描画（スプライト未ロード時のフォールバック）
// ============================================================
function drawFlipped(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number, y: number, w: number, h: number,
  flipX: boolean
) {
  if (!flipX) { ctx.drawImage(img, x, y, w, h); return; }
  ctx.save();
  ctx.translate(x + w, y);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0, w, h);
  ctx.restore();
}

function drawLeopaFallback(
  ctx: CanvasRenderingContext2D,
  state: LeopaState,
  x: number,
  y: number,
  flipX = false
) {
  const w = LEOPA_W;
  const h = LEOPA_H;
  const color: Record<LeopaState, string> = {
    idle:   "#7cb9a8",
    crouch: "#5a9e8a",
    jump:   "#a0d4c4",
    eat:    "#ffd700",
    miss:   "#ff9999",
  };

  ctx.save();
  if (flipX) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    x = 0; y = 0;
  }

  const bodyH = state === "crouch" ? h * 0.5 : h * 0.65;
  const bodyY = state === "crouch" ? y + h * 0.4 : y + h * 0.25;
  ctx.fillStyle = color[state];
  ctx.fillRect(x + 8, bodyY, w - 16, bodyH);

  ctx.beginPath();
  ctx.ellipse(x + w * 0.72, y + h * 0.3, 18, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.ellipse(x + w * 0.8, y + h * 0.26, 4, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.ellipse(x + w * 0.81, y + h * 0.25, 1.5, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = color[state];
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + 8, bodyY + bodyH * 0.5);
  ctx.quadraticCurveTo(x - 18, bodyY + bodyH * 0.8, x - 28, bodyY + bodyH * 0.3);
  ctx.stroke();

  if (state === "jump" || state === "eat") {
    ctx.strokeStyle = "#ff6699";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.85, y + h * 0.3);
    ctx.lineTo(x + w + 12, y + h * 0.28);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCricketFallback(ctx: CanvasRenderingContext2D, c: Cricket, flipX = false) {
  const { x, y, animFrame } = c;
  const bob = Math.sin(animFrame * 1.1) * 3;

  ctx.save();
  if (flipX) {
    ctx.translate(x + CRICKET_W, y);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(x, y);
  }

  const lcx = CRICKET_W / 2;
  const lcy = CRICKET_H / 2 + bob;

  ctx.fillStyle = "#7a5a1a";
  ctx.beginPath();
  ctx.ellipse(lcx, lcy, 18, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#9a7a2a";
  ctx.beginPath();
  ctx.ellipse(lcx + 16, lcy - 2, 9, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#5a3a08";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const fx = lcx - 12 + i * 12;
    ctx.beginPath();
    ctx.moveTo(fx, lcy);
    ctx.lineTo(fx - 8, lcy + 12);
    ctx.moveTo(fx, lcy);
    ctx.lineTo(fx - 4, lcy - 12);
    ctx.stroke();
  }

  ctx.strokeStyle = "#5a3a08";
  ctx.beginPath();
  ctx.moveTo(lcx + 22, lcy - 6);
  ctx.lineTo(lcx + 36, lcy - 18);
  ctx.moveTo(lcx + 22, lcy - 6);
  ctx.lineTo(lcx + 34, lcy - 8);
  ctx.stroke();
  ctx.restore();
}


// ============================================================
// メインコンポーネント
// ============================================================
const SOUNDS = {
  bgmTitle: "/sounds/bgm-title.mp3",
  bgmGame:  "/sounds/bgm-game.mp3",
  success:  "/sounds/success.mp3",
  miss:     "/sounds/miss.mp3",
  clear:    "/sounds/clear.mp3",
};

export default function GamePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gsRef = useRef<GameRef | null>(null);
  const rafRef = useRef<number>(0);
  const imgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);

  const [phase, setPhase] = useState<"title" | "playing" | "result">("title");
  const [remaining, setRemaining] = useState(CRICKET_COUNT);
  const [timeLeft, setTimeLeft] = useState(30);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [finalCatchScore, setFinalCatchScore] = useState(0);
  const [finalTimeBonus, setFinalTimeBonus] = useState(0);
  const [finalMaxCombo, setFinalMaxCombo] = useState(0);
  const [resultType, setResultType] = useState<ResultType>("gameover");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [stats, setStats] = useState({ normalTotal: 0, normalClear: 0, normalTopScore: 0, hardTotal: 0, hardClear: 0, hardTopScore: 0 });
  const [titleLeopaImg, setTitleLeopaImg] = useState<LeopaState>("idle");

  // タイトル画面のレオパアニメーション（idle→crouch→jump→eat→idle...）
  useEffect(() => {
    if (phase !== "title") return;
    const seq: { state: LeopaState; dur: number }[] = [
      { state: "idle",   dur: 1800 },
      { state: "crouch", dur: 300  },
      { state: "jump",   dur: 400  },
      { state: "eat",    dur: 700  },
    ];
    let idx = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      idx = (idx + 1) % seq.length;
      setTitleLeopaImg(seq[idx].state);
      timer = setTimeout(next, seq[idx].dur);
    };
    setTitleLeopaImg(seq[0].state);
    timer = setTimeout(next, seq[0].dur);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    const srcs = [
      ...Object.values(IMG_LEOPA),
      IMG_CRICKET,
      IMG_NANDEYANEN,
    ];
    [...new Set(srcs)].forEach((src) => {
      if (imgCacheRef.current.has(src)) return;
      const img = new Image();
      img.onload = () => { imgCacheRef.current.set(src, img); };
      img.onerror = () => { /* 画像なし → フォールバック描画 */ };
      img.src = src;
    });
  }, []);

  const getImg = useCallback((src: string): HTMLImageElement | null => {
    return imgCacheRef.current.get(src) ?? null;
  }, []);

  const playBgm = useCallback((src: string) => {
    bgmRef.current?.pause();
    const a = new Audio(src);
    a.loop = true;
    a.volume = 0.3;
    a.play().catch(() => {});
    bgmRef.current = a;
  }, []);

  const stopBgm = useCallback(() => {
    bgmRef.current?.pause();
    bgmRef.current = null;
  }, []);

  const playSound = useCallback((src: string, vol = 0.55) => {
    const a = new Audio(src);
    a.volume = vol;
    a.play().catch(() => {});
  }, []);

  useEffect(() => {
    if (!hasInteracted) return;
    if (phase === "title")   playBgm(SOUNDS.bgmTitle);
    else if (phase === "playing") playBgm(SOUNDS.bgmGame);
    else stopBgm();
  }, [phase, hasInteracted, playBgm, stopBgm]);

  useEffect(() => () => { bgmRef.current?.pause(); }, []);

  const createGameState = (diff: Difficulty): GameRef => ({
    leopa: {
      state: "idle",
      stateTimer: 0,
      jumpFromX: LEOPA_BASE_X,
      jumpFromY: GROUND_Y - LEOPA_H,
      jumpX: LEOPA_BASE_X,
      jumpY: GROUND_Y - LEOPA_H,
      jumpToX: LEOPA_BASE_X,
      jumpToY: GROUND_Y - LEOPA_H,
      jumpProgress: 0,
      collisionChecked: false,
      hadHit: false,
      facingLeft: false,
      targetId: -1,
    },
    crickets: Array.from({ length: CRICKET_COUNT }, spawnCricket),
    shake: { intensity: 0, duration: 0 },
    nandeyanen: { visible: false, timer: 0, burst: false },
    hitPopup: { visible: false, timer: 0, label: "", x: 0, y: 0 },
    score: 0,
    catchScore: 0,
    timeBonus: 0,
    combo: 0,
    maxCombo: 0,
    tapPrecision: 0,
    timeLeft: DIFFICULTY_CONFIG[diff].gameDuration,
    running: true,
    resultType: "gameover",
    difficulty: diff,
  });

  // ============================================================
  // 描画
  // ============================================================
  const renderFrame = useCallback(
    (ctx: CanvasRenderingContext2D, gs: GameRef) => {
      const sx = gs.shake.duration > 0 ? (Math.random() - 0.5) * gs.shake.intensity : 0;
      const sy = gs.shake.duration > 0 ? (Math.random() - 0.5) * gs.shake.intensity * 0.5 : 0;

      ctx.save();
      ctx.translate(sx, sy);

      // --- テラリウム背景（全面砂地） ---
      const sandGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
      sandGrad.addColorStop(0,   "#c8a45a");
      sandGrad.addColorStop(0.5, "#d4b06a");
      sandGrad.addColorStop(1,   "#b8904a");
      ctx.fillStyle = sandGrad;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // 砂粒ノイズ（静的）
      ctx.fillStyle = "rgba(180,140,60,0.18)";
      for (let i = 0; i < 120; i++) {
        const nx = (i * 137) % CANVAS_W;
        const ny = (i * 97)  % CANVAS_H;
        ctx.fillRect(nx, ny, 3, 2);
      }

      // 岩（左奥）
      ctx.fillStyle = "#7a6040";
      ctx.beginPath();
      ctx.ellipse(60, CANVAS_H - 40, 55, 38, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#9a7a50";
      ctx.beginPath();
      ctx.ellipse(50, CANVAS_H - 52, 38, 26, -0.2, 0, Math.PI * 2);
      ctx.fill();

      // 岩（右奥）
      ctx.fillStyle = "#7a6040";
      ctx.beginPath();
      ctx.ellipse(340, CANVAS_H - 35, 65, 34, 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#9a7a50";
      ctx.beginPath();
      ctx.ellipse(355, CANVAS_H - 50, 44, 24, 0.15, 0, Math.PI * 2);
      ctx.fill();

      // 小石をランダム配置（静的）
      ctx.fillStyle = "#9a8060";
      for (let i = 0; i < 18; i++) {
        const px = (i * 193 + 40) % (CANVAS_W - 40);
        const py = CANVAS_H - 20 - (i * 37) % 60;
        const pr = 4 + (i * 7) % 10;
        ctx.beginPath();
        ctx.ellipse(px, py, pr, pr * 0.6, (i * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }

      // 地面ライン（奥行き感）
      ctx.fillStyle = "rgba(100,70,20,0.25)";
      ctx.fillRect(0, GROUND_Y, CANVAS_W, 6);

      // --- コオロギ（ホバー強調リングつき） ---
      gs.crickets.forEach((c) => {
        if (!c.alive) return;
        if (gs.leopa.state === "idle") {
          ctx.save();
          ctx.strokeStyle = "rgba(255,255,100,0.55)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(
            c.x + CRICKET_W / 2, c.y + CRICKET_H / 2,
            CRICKET_W / 2 + 6, CRICKET_H / 2 + 6,
            0, 0, Math.PI * 2
          );
          ctx.stroke();
          ctx.restore();
        }
        const img = getImg(IMG_CRICKET);
        if (img) {
          const flipC = c.vx > 0;
          drawFlipped(ctx, img, c.x, c.y, CRICKET_W, CRICKET_H, flipC);
        } else {
          drawCricketFallback(ctx, c, c.vx > 0);
        }
      });

      // --- レオパ ---
      const lx = gs.leopa.jumpX;
      const ly = gs.leopa.jumpY;
      const fl = gs.leopa.facingLeft;
      const leopaImg = getImg(IMG_LEOPA[gs.leopa.state]);
      if (leopaImg) {
        drawFlipped(ctx, leopaImg, lx, ly, LEOPA_W, LEOPA_H, fl);
      } else {
        drawLeopaFallback(ctx, gs.leopa.state, lx, ly, fl);
      }

      // --- ヒットポップアップ（PERFECT / GOOD / コンボ）---
      if (gs.hitPopup.visible) {
        const t = gs.hitPopup.timer / 0.9;
        const alpha = Math.min(1, t * 3);
        const rise = (1 - t) * 40;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = "bold 28px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const isCombo = gs.hitPopup.label.includes("COMBO");
        ctx.fillStyle = isCombo ? "#ffd700" : "#ffffff";
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 4;
        ctx.strokeText(gs.hitPopup.label, gs.hitPopup.x, gs.hitPopup.y - rise);
        ctx.fillText(gs.hitPopup.label, gs.hitPopup.x, gs.hitPopup.y - rise);
        ctx.restore();
      }

      // --- なんでやねん ---
      if (gs.nandeyanen.visible) {
        const alpha = Math.min(1, gs.nandeyanen.timer / 0.2);
        const nImg = getImg(IMG_NANDEYANEN);
        ctx.save();
        ctx.globalAlpha = alpha;
        if (nImg) {
          ctx.drawImage(nImg, CANVAS_W / 2 - 160, 10, 320, 144);
        } else {
          ctx.font = "bold 56px Arial, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.fillText("なんでやねん！", CANVAS_W / 2 + 4, CANVAS_H / 2 + 4);
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 7;
          ctx.fillStyle = "#ff2200";
          ctx.strokeText("なんでやねん！", CANVAS_W / 2, CANVAS_H / 2);
          ctx.fillText("なんでやねん！", CANVAS_W / 2, CANVAS_H / 2);
        }
        ctx.restore();
      }

      ctx.restore();
    },
    [getImg]
  );

  // ============================================================
  // ゲームループ更新
  // ============================================================
  const updateFrame = useCallback((gs: GameRef, dt: number, sfx?: {
    onCatch: () => void; onMiss: () => void; onClear: () => void; onGameOver: () => void;
  }) => {
    if (!gs.running) return;

    // タイマー
    gs.timeLeft = Math.max(0, gs.timeLeft - dt);
    if (gs.timeLeft <= 0) {
      gs.resultType = "gameover";
      gs.running = false;
      sfx?.onGameOver();
      return;
    }

    // シェイク減衰
    if (gs.shake.duration > 0) {
      gs.shake.duration -= dt;
      if (gs.shake.duration <= 0) {
        gs.shake.intensity = 0;
        gs.shake.duration = 0;
      }
    }

    // なんでやねんタイマー
    if (gs.nandeyanen.visible) {
      gs.nandeyanen.timer -= dt;
      if (gs.nandeyanen.timer <= 0) gs.nandeyanen.visible = false;
    }
    // ヒットポップアップタイマー
    if (gs.hitPopup.visible) {
      gs.hitPopup.timer -= dt;
      if (gs.hitPopup.timer <= 0) gs.hitPopup.visible = false;
    }

    // ---- レオパ ステートマシン ----
    const leopa = gs.leopa;
    leopa.stateTimer = Math.max(0, leopa.stateTimer - dt);

    if (leopa.state === "crouch" && leopa.stateTimer <= 0) {
      leopa.state = "jump";
      leopa.stateTimer = 0.38;
      leopa.jumpProgress = 0;
      leopa.jumpX = leopa.jumpFromX;
      leopa.jumpFromY = leopa.jumpY;
      leopa.collisionChecked = false;
      leopa.hadHit = false;
    } else if (leopa.state === "jump") {
      // ジャンプ中もターゲットのコオロギを追従（速いコオロギに届かない問題を解消）
      const tracked = gs.crickets.find((c) => c.id === leopa.targetId && c.alive);
      if (tracked) {
        leopa.jumpToX = tracked.x + CRICKET_W / 2 - LEOPA_W / 2;
        leopa.jumpToY = tracked.y + CRICKET_H / 2 - LEOPA_H / 2;
      }

      leopa.jumpProgress = Math.min(1, leopa.jumpProgress + dt / 0.35);
      const t = 1 - Math.pow(1 - leopa.jumpProgress, 3);
      leopa.jumpX = leopa.jumpFromX + t * (leopa.jumpToX - leopa.jumpFromX);
      const arc = Math.sin(leopa.jumpProgress * Math.PI) * 40;
      const yT = leopa.jumpFromY + t * (leopa.jumpToY - leopa.jumpFromY);
      leopa.jumpY = yT - arc;

      if (!leopa.collisionChecked && leopa.jumpProgress >= 0.80) {
        leopa.collisionChecked = true;

        // タップ時に指定したコオロギのみを対象にする（通過した別コオロギを誤判定しない）
        const targetIdx = gs.crickets.findIndex(
          (c) => c.id === leopa.targetId && c.alive
        );
        const hits = targetIdx >= 0 ? [targetIdx] : [];

        if (hits.length > 0) {
          // 精度のみで判定（ランダム要素なし）
          const PERFECT_ZONE = 0.70;
          const escaped = gs.tapPrecision < PERFECT_ZONE;

          if (!escaped) {
            const catchX = gs.crickets[hits[0]].x + CRICKET_W / 2;
            const catchY = gs.crickets[hits[0]].y + CRICKET_H / 2;
            hits.forEach((i) => { gs.crickets[i].alive = false; });
            leopa.hadHit = true;
            gs.combo++;
            gs.maxCombo = Math.max(gs.maxCombo, gs.combo);
            const mult = Math.min(gs.combo, 5);
            const basePts = gs.tapPrecision > 0.9 ? 15 :
                            gs.tapPrecision > 0.75 ? 10 : 5;
            const pts = basePts * mult;
            gs.score += pts;
            gs.catchScore += pts;
            const qualLabel = gs.tapPrecision > 0.9 ? "PERFECT! 🎯" :
                              gs.tapPrecision > 0.75 ? "GOOD! 👍" : "OK";
            const comboLabel = gs.combo >= 2 ? `${qualLabel}  ×${mult} COMBO!` : qualLabel;
            gs.hitPopup = { visible: true, timer: 0.9, label: comboLabel, x: catchX, y: catchY - 30 };
            sfx?.onCatch();
            if (gs.crickets.every((c) => !c.alive)) {
              gs.resultType = "clear";
              gs.timeBonus = Math.ceil(gs.timeLeft) * 10;
              gs.score += gs.timeBonus;
              gs.running = false;
              sfx?.onClear();
            }
          } else {
            gs.combo = 0;
            sfx?.onMiss();
            triggerNandeyanen(gs);
          }
        } else {
          gs.combo = 0; // 空振り
        }
      }

      if (leopa.stateTimer <= 0) {
        if (leopa.hadHit) {
          leopa.state = "eat";
          leopa.stateTimer = 0.4;
        } else {
          leopa.state = "miss";
          leopa.stateTimer = 0.5;
          if (!gs.nandeyanen.visible) triggerNandeyanen(gs);
        }
      }
    } else if (
      (leopa.state === "eat" || leopa.state === "miss") &&
      leopa.stateTimer <= 0
    ) {
      leopa.state = "idle";
      leopa.jumpX = leopa.jumpToX;
      leopa.jumpY = leopa.jumpToY;
    }

    // ---- コオロギ移動 ----
    gs.crickets.forEach((c) => {
      if (!c.alive) return;
      c.x += c.vx * dt;
      c.y += c.vy * dt;

      const minX = 10;
      const maxX = CANVAS_W - CRICKET_W - 10;
      if (c.x < minX) { c.x = minX; c.vx = Math.abs(c.vx); }
      if (c.x > maxX) { c.x = maxX; c.vx = -Math.abs(c.vx); }

      const minY = 40;
      const maxY = GROUND_Y - CRICKET_H - 2;
      if (c.y < minY) { c.y = minY; c.vy = Math.abs(c.vy); }
      if (c.y > maxY) { c.y = maxY; c.vy = -Math.abs(c.vy); }

      c.dirTimer -= dt;
      if (c.dirTimer <= 0) {
        const sm = DIFFICULTY_CONFIG[gs.difficulty].speedMult;
        c.vx = (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 80) * sm;
        c.vy = (Math.random() - 0.5) * 50 * sm;
        c.dirTimer = 0.4 + Math.random() * 0.8;
      }

      c.animTimer += dt;
      if (c.animTimer > 0.1) {
        c.animFrame = (c.animFrame + 1) % 6;
        c.animTimer = 0;
      }
    });
  }, []);

  function triggerNandeyanen(gs: GameRef) {
    gs.nandeyanen.visible = true;
    gs.nandeyanen.timer = 0.5 + Math.random() * 0.5;
    gs.nandeyanen.burst = Math.random() > 0.5;
    gs.shake.intensity = 14;
    gs.shake.duration = 0.45;
  }

  // ============================================================
  // ゲームループ起動
  // ============================================================
  const launchLoop = useCallback((gs: GameRef) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let prevTs = 0;
    const loop = (ts: number) => {
      try {
        const dt = prevTs ? Math.min((ts - prevTs) / 1000, 0.05) : 0;
        prevTs = ts;

        updateFrame(gs, dt, {
          onCatch: () => playSound(SOUNDS.success),
          onMiss:  () => playSound(SOUNDS.miss),
          onClear: () => { playSound(SOUNDS.clear); stopBgm(); },
          onGameOver: () => stopBgm(),
        });
        renderFrame(ctx, gs);

        setRemaining(gs.crickets.filter((c) => c.alive).length);
        setTimeLeft(Math.ceil(gs.timeLeft));
        setScore(gs.score);
        setCombo(gs.combo);

        if (!gs.running) {
          setFinalScore(gs.score);
          setFinalCatchScore(gs.catchScore);
          setFinalTimeBonus(gs.timeBonus);
          setFinalMaxCombo(gs.maxCombo);
          setResultType(gs.resultType);
          setPhase("result");
          logPlay(gs.difficulty, gs.resultType, gs.score);
          fetchStats().then(setStats);
          return;
        }
        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        console.error("[GameLoop]", err);
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [updateFrame, renderFrame, playSound, stopBgm]);

  const startGame = useCallback((diff: Difficulty = "normal") => {
    setHasInteracted(true);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const gs = createGameState(diff);
    gsRef.current = gs;
    setDifficulty(diff);
    setRemaining(CRICKET_COUNT);
    setTimeLeft(DIFFICULTY_CONFIG[diff].gameDuration);
    setPhase("playing");

    launchLoop(gs);
  }, [launchLoop]);

  const toCanvasCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (CANVAS_W / rect.width),
      y: (clientY - rect.top)  * (CANVAS_H / rect.height),
    };
  }, []);

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const gs = gsRef.current;
    if (!gs || !gs.running) return;
    if (gs.leopa.state !== "idle") return;

    const pos = toCanvasCoords(clientX, clientY);
    if (!pos) return;

    const TAP_RADIUS = DIFFICULTY_CONFIG[gs.difficulty].tapRadius;
    let nearest: { c: Cricket; dist: number } | null = null;
    gs.crickets.forEach((c) => {
      if (!c.alive) return;
      const cx = c.x + CRICKET_W / 2;
      const cy = c.y + CRICKET_H / 2;
      const d  = Math.hypot(cx - pos.x, cy - pos.y);
      if (d < TAP_RADIUS && (!nearest || d < nearest.dist)) {
        nearest = { c, dist: d };
      }
    });

    if (!nearest) return;

    // タップ精度（0=外周, 1=ど真ん中）→ 逃げ確率に影響
    const nearestResult = nearest as { c: Cricket; dist: number };
    gs.tapPrecision = Math.max(0, 1 - nearestResult.dist / TAP_RADIUS);
    gs.leopa.targetId = nearestResult.c.id;

    const target = nearestResult.c;
    gs.leopa.state = "crouch";
    gs.leopa.stateTimer = 0.15;
    gs.leopa.jumpFromX  = gs.leopa.jumpX;
    gs.leopa.jumpFromY  = gs.leopa.jumpY;
    gs.leopa.jumpToX    = target.x + CRICKET_W / 2 - LEOPA_W / 2;
    gs.leopa.jumpToY    = target.y + CRICKET_H / 2 - LEOPA_H / 2;
    gs.leopa.facingLeft = gs.leopa.jumpToX < gs.leopa.jumpFromX;
  }, [toCanvasCoords]);

  useEffect(() => { fetchStats().then(setStats); }, []);
  useEffect(() => () => { cancelAnimationFrame(rafRef.current); }, []);

  // ============================================================
  // JSX
  // ============================================================
  return (
    <div className={`game-root${phase === "playing" ? " game-screen--active" : ""}`}>
      <div className="w-full max-w-sm">
      {/* ===== タイトル画面 ===== */}
      {phase === "title" && (
        <div className="text-center space-y-4 px-4 py-4" onClick={() => { if (!hasInteracted) { setHasInteracted(true); } }}>
          <div>
            <p className="text-green-400 text-xs tracking-widest mb-1">── LEOPA PAKUTTO GAME ──</p>
            <h1 className="game-title-h1">
              レオパの<br />
              コオロギぱくっと<br />
              なんでやねん
            </h1>
          </div>

          {/* レオパをどーんと表示 */}
          <div className="flex justify-center py-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={IMG_LEOPA[titleLeopaImg]} alt="レオパ" width={160} height={160} />
          </div>

          <div className="game-title-desc text-sm leading-relaxed text-left w-full max-w-xs mx-auto">
            <p>🎯 コオロギをタップでレオパが突進！</p>
            <p>🎯 ５匹全部食べたらクリア！</p>
            <p>🎯 ど真ん中を狙え！外したらなんでやねん！</p>
          </div>

          <div className="flex flex-col gap-3 w-full max-w-xs mx-auto">
            <button type="button" className="game-btn-start" onClick={() => startGame("normal")}>
              ▶ 通常版スタート（30秒）
            </button>
            <button type="button" className="game-btn-hard" onClick={() => startGame("hard")}>
              🔥 激むずスタート（15秒）
            </button>
          </div>

          <div className="game-title-desc text-xs mt-2 space-y-1">
            <p>累計プレイ：{stats.normalTotal + stats.hardTotal}回</p>
            <p>通常版：{stats.normalTotal}回（クリア {stats.normalClear}回）　最高 {stats.normalTopScore}pt</p>
            <p>激ムズ：{stats.hardTotal}回（クリア {stats.hardClear}回）　最高 {stats.hardTopScore}pt</p>
          </div>

          <p className="game-title-desc text-xs mt-3">
            BGM：魔王魂　効果音：効果音ラボ　音声：音読さん
          </p>
        </div>
      )}

      {/* ===== ゲーム画面（canvas は常時マウント・表示だけ切替） ===== */}
      <div className={phase === "playing" ? "game-screen" : "game-screen game-screen--hidden"}>
        <div className="game-hud">
          <span>🦗 残り {remaining}匹</span>
          <span className={combo >= 3 ? "game-hud-combo--hot" : "game-hud-combo"}>
            {combo >= 2 ? `🔥 ${combo} COMBO` : ""}
          </span>
          <span>⭐ {score}</span>
          <span className={timeLeft <= 10 ? "game-hud-time--urgent" : "game-hud-time"}>
            ⏱ {timeLeft}秒
          </span>
        </div>

        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="game-canvas"
          onClick={(e) => handleTap(e.clientX, e.clientY)}
          onTouchStart={(e) => {
            e.preventDefault();
            const t = e.touches[0];
            handleTap(t.clientX, t.clientY);
          }}
        />

        <button
          type="button"
          className="game-btn-title"
          onClick={() => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            stopBgm();
            setPhase("title");
          }}
        >
          ↩ タイトルへ
        </button>
      </div>

      {/* ===== リザルト画面 ===== */}
      {phase === "result" && (
        <div className="game-result">
          <p className="text-green-400 text-xs tracking-widest mb-4">── RESULT ──</p>

          {resultType === "clear" ? (
            <>
              <h2 className="game-result-title game-result-title--clear">CLEAR！🎉</h2>
              <p className="game-result-sub">コオロギ全部ぱくっとした！</p>
            </>
          ) : (
            <>
              <h2 className="game-result-title game-result-title--gameover">TIME UP！</h2>
              <p className="game-result-sub">なんでやねん！</p>
            </>
          )}

          <div className="flex justify-center py-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resultType === "clear" ? "/images/leopa-happy.png" : "/images/leopa-sleep.png"}
              alt="レオパ"
              width={160}
              height={160}
            />
          </div>

          <div className="game-result-score mt-3">
            <p>スコア <span className="game-result-score-num">{finalScore}</span> pt</p>
            <div className="game-result-ranking game-result-breakdown mt-2 space-y-1">
              <div className="flex justify-between">
                <span>🦗 キャッチスコア</span>
                <span>{finalCatchScore} pt</span>
              </div>
              {resultType === "clear" && (
                <div className="flex justify-between">
                  <span>⏱ 残り時間ボーナス</span>
                  <span>{finalTimeBonus} pt</span>
                </div>
              )}
              {finalMaxCombo >= 2 && (
                <div className="flex justify-between">
                  <span>🔥 最大コンボ</span>
                  <span>{finalMaxCombo} COMBO</span>
                </div>
              )}
            </div>
          </div>

          {(stats.normalTotal > 0 || stats.hardTotal > 0) && (
            <div className="game-result-ranking mt-4 space-y-1">
              <p className="game-result-ranking-ttl">── みんなの記録 ──</p>
              <div className="flex justify-between">
                <span>通常</span>
                <span>{stats.normalTotal}回（クリア {stats.normalClear}回）</span>
              </div>
              <div className="flex justify-between">
                <span>激むず</span>
                <span>{stats.hardTotal}回（クリア {stats.hardClear}回）</span>
              </div>
            </div>
          )}

          <div className="mt-6 space-y-2">
            <button type="button" className="game-btn-retry" onClick={() => startGame(difficulty)}>
              ▶ もう一回！
            </button>
            <button type="button" className="game-btn-title" onClick={() => setPhase("title")}>
              ↩ タイトルへ
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
