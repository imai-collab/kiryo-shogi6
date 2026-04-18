/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * GitHub Export Update: Forced file modification to trigger GitHub export diff.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as ShogiModule from 'shogi.js';
import confetti from 'canvas-confetti';
import { Trophy, RotateCcw, ChevronLeft, ChevronRight, Info, AlertCircle, Upload, Plus, Loader2, Edit2, Check, ArrowUp, ArrowDown, Trash2, ListOrdered, Copy, ClipboardCopy } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import { solveTsumeShogi, Move as SolverMove } from './lib/solver';
import problemsData from './data/problems.json';
import settingsData from './data/settings.json';

// Handle different export styles of shogi.js
const Shogi = (ShogiModule as any).Shogi || (ShogiModule as any).default || ShogiModule;
const Piece = (ShogiModule as any).Piece || (ShogiModule as any).default?.Piece;

// Define Color locally to avoid import issues
enum Color {
  Black = 0,
  White = 1,
}

// Piece display names (Kanji)
const PIECE_NAMES: Record<string, string> = {
  FU: '歩',
  KY: '香',
  KE: '桂',
  GI: '銀',
  KI: '金',
  KA: '角',
  HI: '飛',
  OU: '玉',
  TO: 'と',
  NY: '杏',
  NK: '圭',
  NG: '全',
  UM: '馬',
  RY: '龍',
};

const fillGoteHand = (shogiObj: any) => {
  const TOTAL_PIECES: Record<string, number> = { FU: 18, KY: 4, KE: 4, GI: 4, KI: 4, KA: 2, HI: 2 };
  const counts: Record<string, number> = { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 };

  for (let x = 1; x <= 9; x++) {
    for (let y = 1; y <= 9; y++) {
      const p = shogiObj.get(x, y);
      if (p) {
        let kind = p.kind;
        if (['TO', 'NY', 'NK', 'NG'].includes(kind)) {
          if (kind === 'TO') kind = 'FU';
          if (kind === 'NY') kind = 'KY';
          if (kind === 'NK') kind = 'KE';
          if (kind === 'NG') kind = 'GI';
        }
        if (kind === 'UM') kind = 'KA';
        if (kind === 'RY') kind = 'HI';
        if (counts[kind] !== undefined) counts[kind]++;
      }
    }
  }

  const senteHand = shogiObj.getHandsSummary(Color.Black);
  for (const kind in senteHand) {
    if (counts[kind] !== undefined) counts[kind] += senteHand[kind];
  }

  const goteHand = shogiObj.getHandsSummary(Color.White);
  for (const kind in goteHand) {
    while (shogiObj.getHandsSummary(Color.White)[kind] > 0) {
      shogiObj.popFromHand(kind, Color.White);
    }
  }

  for (const kind in TOTAL_PIECES) {
    const remaining = TOTAL_PIECES[kind] - counts[kind];
    for (let i = 0; i < remaining; i++) {
      shogiObj.pushToHand(new Piece('-' + kind));
    }
  }
};

interface Position {
  x: number;
  y: number;
}

interface Move {
  from?: Position;
  to: Position;
  piece?: string;
  promote?: boolean;
}

interface Problem {
  id: number;
  title: string;
  description: string;
  initialSfen: string; // SFEN format for initial board
  solution?: Move[]; // Sequence of correct moves (user, response, user...)
}

const INITIAL_PROBLEMS: Problem[] = problemsData as Problem[];

const applyMoveToShogi = (shogiObj: any, move: Move) => {
  if (move.from) {
    shogiObj.move(move.from.x, move.from.y, move.to.x, move.to.y, move.promote);
  } else if (move.piece) {
    shogiObj.drop(move.to.x, move.to.y, move.piece);
  }
};

const cloneShogi = (shogiObj: any) => {
  const newShogi = new Shogi();
  const sfen = shogiObj.toSFENString ? shogiObj.toSFENString(1) : shogiObj.toSFEN(1);
  if (newShogi.initializeFromSFENString) {
    newShogi.initializeFromSFENString(sfen);
  } else if (newShogi.initializeFromSFEN) {
    newShogi.initializeFromSFEN(sfen);
  }
  return newShogi;
};

const getLegalMoves = (currentShogi: any, color: Color): Move[] => {
  const legalMoves: Move[] = [];
  
  for (let x = 1; x <= 9; x++) {
    for (let y = 1; y <= 9; y++) {
      const piece = currentShogi.get(x, y);
      if (piece && piece.color === color) {
        const pseudoMoves = currentShogi.getMovesFrom(x, y);
        for (const pm of pseudoMoves) {
          const isPromotionZone = (c: Color, row: number) => c === Color.Black ? row <= 3 : row >= 7;
          const isPromoted = ["TO", "NY", "NK", "NG", "UM", "RY"].includes(piece.kind);
          const canPromote = !isPromoted && 
                             !['KI', 'OU', 'GY'].includes(piece.kind) &&
                             (isPromotionZone(piece.color, y) || isPromotionZone(piece.color, pm.to.y));
                             
          const mustPromote = canPromote && (
            (['FU', 'KY'].includes(piece.kind) && (piece.color === Color.Black ? pm.to.y === 1 : pm.to.y === 9)) ||
            (piece.kind === 'KE' && (piece.color === Color.Black ? pm.to.y <= 2 : pm.to.y >= 8))
          );

          if (!mustPromote) {
            const sfen1 = currentShogi.toSFENString(1);
            try {
              currentShogi.move(x, y, pm.to.x, pm.to.y, false);
              if (!currentShogi.isCheck(color)) {
                legalMoves.push({ from: { x, y }, to: { x: pm.to.x, y: pm.to.y }, promote: false });
              }
            } catch (e) {}
            if (currentShogi.initializeFromSFENString) {
              currentShogi.initializeFromSFENString(sfen1);
            } else {
              currentShogi.initializeFromSFEN(sfen1);
            }
          }

          if (canPromote || mustPromote) {
            const sfen2 = currentShogi.toSFENString(1);
            try {
              currentShogi.move(x, y, pm.to.x, pm.to.y, true);
              if (!currentShogi.isCheck(color)) {
                legalMoves.push({ from: { x, y }, to: { x: pm.to.x, y: pm.to.y }, promote: true });
              }
            } catch (e) {}
            if (currentShogi.initializeFromSFENString) {
              currentShogi.initializeFromSFENString(sfen2);
            } else {
              currentShogi.initializeFromSFEN(sfen2);
            }
          }
        }
      }
    }
  }

  const drops = currentShogi.getDropsBy(color);
  for (const drop of drops) {
    if (color === Color.Black) {
      if ((drop.kind === 'FU' || drop.kind === 'KY') && drop.to.y === 1) continue;
      if (drop.kind === 'KE' && drop.to.y <= 2) continue;
    } else {
      if ((drop.kind === 'FU' || drop.kind === 'KY') && drop.to.y === 9) continue;
      if (drop.kind === 'KE' && drop.to.y >= 8) continue;
    }

    if (drop.kind === 'FU') {
      let hasPawn = false;
      for (let y = 1; y <= 9; y++) {
        const p = currentShogi.get(drop.to.x, y);
        if (p && p.kind === 'FU' && p.color === color) {
          hasPawn = true;
          break;
        }
      }
      if (hasPawn) continue;
    }

    const sfen = currentShogi.toSFENString(1);
    try {
      currentShogi.drop(drop.to.x, drop.to.y, drop.kind);
      if (!currentShogi.isCheck(color)) {
        legalMoves.push({ to: { x: drop.to.x, y: drop.to.y }, piece: drop.kind });
      }
    } catch (e) {}
    if (currentShogi.initializeFromSFENString) {
      currentShogi.initializeFromSFENString(sfen);
    } else {
      currentShogi.initializeFromSFEN(sfen);
    }
  }

  return legalMoves;
};

const findBestDefenderMove = (currentShogi: any, maxDepth: number, aiMoveHistoryMap: Record<string, Move>): { bestMove: Move | null, steps: number, mate: boolean } => {
  const memo = new Map<string, { steps: number, mate: boolean, bestMove: Move | null }>();

  function search(depth: number, isBlack: boolean): { steps: number, mate: boolean, bestMove: Move | null } {
    const sfen = currentShogi.toSFENString(1);
    const hash = `${sfen}-${depth}-${isBlack}`;
    if (memo.has(hash)) return memo.get(hash)!;

    if (depth === 0) {
      return { steps: 0, mate: false, bestMove: null };
    }

    const color = isBlack ? Color.Black : Color.White;
    let legalMoves = getLegalMoves(currentShogi, color);

    if (isBlack) {
      // 探索空間を減らすため、先手（プレイヤー）のシミュレーションは王手のみに絞る
      legalMoves = legalMoves.filter(m => {
        const s = currentShogi.toSFENString(1);
        applyMoveToShogi(currentShogi, m);
        const isCheck = currentShogi.isCheck(Color.White);
        if (currentShogi.initializeFromSFENString) {
          currentShogi.initializeFromSFENString(s);
        } else {
          currentShogi.initializeFromSFEN(s);
        }
        return isCheck;
      });

      if (legalMoves.length === 0) {
        const res = { steps: 0, mate: false, bestMove: null };
        memo.set(hash, res);
        return res;
      }

      let bestSteps = Infinity;
      let bestMove: Move | null = null;

      for (const move of legalMoves) {
        if (move.piece === 'FU') {
           const s = currentShogi.toSFENString(1);
           applyMoveToShogi(currentShogi, move);
           const whiteMoves = getLegalMoves(currentShogi, Color.White);
           if (currentShogi.initializeFromSFENString) {
             currentShogi.initializeFromSFENString(s);
           } else {
             currentShogi.initializeFromSFEN(s);
           }
           if (whiteMoves.length === 0) {
             continue;
           }
        }

        const s = currentShogi.toSFENString(1);
        applyMoveToShogi(currentShogi, move);
        const res = search(depth - 1, false);
        if (currentShogi.initializeFromSFENString) {
          currentShogi.initializeFromSFENString(s);
        } else {
          currentShogi.initializeFromSFEN(s);
        }

        if (res.mate) {
          if (res.steps < bestSteps) {
            bestSteps = res.steps;
            bestMove = move;
          }
        }
      }

      const finalRes = bestMove ? { steps: bestSteps + 1, mate: true, bestMove } : { steps: 0, mate: false, bestMove: null };
      memo.set(hash, finalRes);
      return finalRes;

    } else {
      if (legalMoves.length === 0) {
        const res = { steps: 0, mate: true, bestMove: null };
        memo.set(hash, res);
        return res;
      }

      let maxSteps = -1;
      let bestMoves: Move[] = [];
      let escapeMoves: Move[] = [];

      for (const move of legalMoves) {
        const s = currentShogi.toSFENString(1);
        applyMoveToShogi(currentShogi, move);
        const res = search(depth - 1, true);
        if (currentShogi.initializeFromSFENString) {
          currentShogi.initializeFromSFENString(s);
        } else {
          currentShogi.initializeFromSFEN(s);
        }

        if (!res.mate) {
          escapeMoves.push(move);
        } else {
          if (res.steps > maxSteps) {
            maxSteps = res.steps;
            bestMoves = [move];
          } else if (res.steps === maxSteps) {
            bestMoves.push(move);
          }
        }
      }

      if (escapeMoves.length > 0) {
        let bestEscape = escapeMoves[0];
        let bestScore = -Infinity;
        const sfenKey = currentShogi.toSFENString(1);
        const previousMove = aiMoveHistoryMap[sfenKey];
        
        for (const m of escapeMoves) {
          let score = 0;
          // 駒を取る手はプラス評価
          if (m.from && currentShogi.get(m.to.x, m.to.y)) {
            score += 10;
          }
          // 玉を逃がす手はプラス評価
          if (m.from) {
            const p = currentShogi.get(m.from.x, m.from.y);
            if (p && p.kind === 'OU') {
              score += 5;
            }
          }
          // 持ち駒を打つ手はマイナス評価（無駄合いを避ける）
          if (m.piece) {
            score -= 5;
          }
          
          // 前回と同じ手はマイナス評価（別の手を優先）
          if (previousMove && m.from?.x === previousMove.from?.x && m.from?.y === previousMove.from?.y && m.to.x === previousMove.to.x && m.to.y === previousMove.to.y && m.piece === previousMove.piece && m.promote === previousMove.promote) {
            score -= 100;
          }

          // ランダム性を少し加えて毎回同じ手にならないようにする
          score += Math.random();

          if (score > bestScore) {
            bestScore = score;
            bestEscape = m;
          }
        }

        const escapeRes = { steps: 0, mate: false, bestMove: bestEscape };
        memo.set(hash, escapeRes);
        return escapeRes;
      }

      let randomBest = null;
      if (bestMoves.length > 0) {
        const sfenKey = currentShogi.toSFENString(1);
        const previousMove = aiMoveHistoryMap[sfenKey];
        
        const alternativeMoves = bestMoves.filter(m => 
          !previousMove || 
          !(m.from?.x === previousMove.from?.x && m.from?.y === previousMove.from?.y && m.to.x === previousMove.to.x && m.to.y === previousMove.to.y && m.piece === previousMove.piece && m.promote === previousMove.promote)
        );

        if (alternativeMoves.length > 0) {
          randomBest = alternativeMoves[Math.floor(Math.random() * alternativeMoves.length)];
        } else {
          randomBest = bestMoves[Math.floor(Math.random() * bestMoves.length)];
        }
      }

      const finalRes = { steps: maxSteps + 1, mate: true, bestMove: randomBest };
      memo.set(hash, finalRes);
      return finalRes;
    }
  }

  return search(maxDepth, false);
};

export default function App() {
  const [appTitle, setAppTitle] = useState(settingsData.title || '詰将棋マスター');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState('');

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          if (data.title) {
            setAppTitle(data.title);
          }
        }
      } catch (e) {
        console.error("Failed to fetch settings from API", e);
        const localTitle = localStorage.getItem('tsumeShogiAppTitle');
        if (localTitle) setAppTitle(localTitle);
      }
    };
    fetchSettings();
  }, []);

  const handleTitleSave = () => {
    if (tempTitle.trim()) {
      const newTitle = tempTitle.trim();
      setAppTitle(newTitle);
      localStorage.setItem('tsumeShogiAppTitle', newTitle);
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      }).catch(e => console.error("Failed to save settings to API", e));
    }
    setIsEditingTitle(false);
  };

  const [problems, setProblems] = useState<Problem[]>(INITIAL_PROBLEMS);
  const [isLoadingProblems, setIsLoadingProblems] = useState(true);
  const [currentProblemIndex, setCurrentProblemIndex] = useState(0);
  const [shogi, setShogi] = useState<any>(null);
  const [selectedSquare, setSelectedSquare] = useState<Position | null>(null);
  const [selectedHandPiece, setSelectedHandPiece] = useState<{ piece: string; color: Color } | null>(null);
  const [message, setMessage] = useState<string>('あなたの番です。');
  const [isGameOver, setIsGameOver] = useState(false);
  const [moveHistory, setMoveHistory] = useState<Move[]>([]);
  const [showInfo, setShowInfo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPromotionMove, setPendingPromotionMove] = useState<Move | null>(null);
  const [sfenHistory, setSfenHistory] = useState<string[]>([]);
  const [aiMoveHistoryMap, setAiMoveHistoryMap] = useState<Record<string, Move>>({});
  
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string, onConfirm: () => void } | null>(null);
  const [alertDialog, setAlertDialog] = useState<string | null>(null);
  const [sfenInputDialog, setSfenInputDialog] = useState(false);
  const [sfenInput, setSfenInput] = useState('');
  const [editTool, setEditTool] = useState<{ kind: string, color: Color } | 'eraser' | null>(null);

  useEffect(() => {
    const fetchProblems = async () => {
      let apiProblems: Problem[] | null = null;
      try {
        const res = await fetch('/api/problems');
        if (res.ok) {
          const data = await res.json();
          if (data && data.length > 0) {
            apiProblems = data;
          }
        }
      } catch (e) {
        console.error("Failed to fetch problems from API", e);
      }

      const saved = localStorage.getItem('tsumeShogiProblems');
      let localProblems: Problem[] | null = null;
      if (saved) {
        try {
          localProblems = JSON.parse(saved);
        } catch (e) {
          console.error("Failed to parse saved problems", e);
        }
      }

      // Prefer the source with more problems to prevent data loss on ephemeral container restarts
      if (localProblems && apiProblems) {
        if (localProblems.length >= apiProblems.length) {
          setProblems(localProblems);
          // Sync back to API
          fetch('/api/problems', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(localProblems)
          }).catch(() => {});
        } else {
          setProblems(apiProblems);
        }
      } else if (apiProblems) {
        setProblems(apiProblems);
      } else if (localProblems) {
        setProblems(localProblems);
        // Sync back to API
        fetch('/api/problems', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(localProblems)
        }).catch(() => {});
      }
      
      setIsLoadingProblems(false);
    };
    fetchProblems();
  }, []);

  useEffect(() => {
    if (isLoadingProblems) return;
    localStorage.setItem('tsumeShogiProblems', JSON.stringify(problems));
    fetch('/api/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(problems)
    }).catch(e => console.error("Failed to save problems to API", e));
  }, [problems, isLoadingProblems]);

  const currentProblem = problems[currentProblemIndex];

  const handleAddEmptyProblem = () => {
    const newProblem: Problem = {
      id: Date.now(),
      title: `追加問題`,
      description: '新しい問題です。盤面を編集してください。',
      initialSfen: "9/9/9/9/9/9/9/9/9 b - 1",
    };
    setProblems(prev => {
      const updated = [...prev];
      updated.splice(currentProblemIndex + 1, 0, newProblem);
      return updated.map((p, i) => ({ ...p, id: i + 1 }));
    });
    setCurrentProblemIndex(currentProblemIndex + 1);
    setIsEditMode(true);
    setAlertDialog('新しい問題を追加しました。盤面を編集してください。');
  };

  const toggleEditMode = () => {
    if (isEditMode) {
      // Exiting edit mode, just save the new SFEN
      setSelectedSquare(null);
      const newSfen = shogi.toSFENString(1);
      const updatedProblems = [...problems];
      updatedProblems[currentProblemIndex] = {
        ...currentProblem,
        initialSfen: newSfen,
      };
      setProblems(updatedProblems);
      setAlertDialog(`盤面を更新しました。`);
    }
    setIsEditMode(!isEditMode);
  };

  const deleteProblem = () => {
    setConfirmDialog({
      message: 'この問題を削除しますか？',
      onConfirm: () => {
        const newProblems = problems.filter((_, idx) => idx !== currentProblemIndex);
        if (newProblems.length === 0) {
          setAlertDialog('最後の問題は削除できません。');
          return;
        }
        setProblems(newProblems);
        if (currentProblemIndex >= newProblems.length) {
          setCurrentProblemIndex(newProblems.length - 1);
        }
      }
    });
  };

  const moveProblemUp = () => {
    if (currentProblemIndex > 0) {
      const newProblems = [...problems];
      const temp = newProblems[currentProblemIndex];
      newProblems[currentProblemIndex] = newProblems[currentProblemIndex - 1];
      newProblems[currentProblemIndex - 1] = temp;
      setProblems(newProblems);
      setCurrentProblemIndex(currentProblemIndex - 1);
    }
  };

  const moveProblemDown = () => {
    if (currentProblemIndex < problems.length - 1) {
      const newProblems = [...problems];
      const temp = newProblems[currentProblemIndex];
      newProblems[currentProblemIndex] = newProblems[currentProblemIndex + 1];
      newProblems[currentProblemIndex + 1] = temp;
      setProblems(newProblems);
      setCurrentProblemIndex(currentProblemIndex + 1);
    }
  };

  const renumberProblems = () => {
    setConfirmDialog({
      message: 'すべての問題のタイトルを「第1問」「第2問」...と順番通りに振り直しますか？',
      onConfirm: () => {
        const newProblems = problems.map((p, idx) => ({
          ...p,
          id: idx + 1,
          title: `第${idx + 1}問`
        }));
        setProblems(newProblems);
        setAlertDialog('問題番号を振り直しました。');
      }
    });
  };

  const duplicateProblem = () => {
    const currentSfen = shogi.toSFENString(1);
    const newProblem = {
      ...currentProblem,
      id: Date.now(),
      title: `${currentProblem.title} (コピー)`,
      initialSfen: currentSfen,
    };
    
    setProblems(prev => {
      const updated = [...prev];
      if (isEditMode) {
        updated[currentProblemIndex] = {
          ...currentProblem,
          initialSfen: currentSfen
        };
      }
      updated.splice(currentProblemIndex + 1, 0, newProblem);
      return updated.map((p, idx) => ({ ...p, id: idx + 1 }));
    });
    setCurrentProblemIndex(currentProblemIndex + 1);
    setAlertDialog('問題を複製しました。現在の盤面データがコピーされています。');
  };

  const copyAllData = async () => {
    let currentDataToCopy = problems;
    if (isEditMode && shogi) {
      const currentSfen = shogi.toSFENString(1);
      currentDataToCopy = [...problems];
      currentDataToCopy[currentProblemIndex] = {
        ...currentProblem,
        initialSfen: currentSfen
      };
      setProblems(currentDataToCopy);
    }
    
    try {
      await navigator.clipboard.writeText(JSON.stringify(currentDataToCopy, null, 2));
      setAlertDialog('すべての問題データをクリップボードにコピーしました！');
    } catch (err) {
      setAlertDialog('クリップボードへのコピーに失敗しました。');
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = error => reject(error);
      });
      reader.readAsDataURL(file);
      const base64Data = await base64Promise;

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `提供されたファイル（画像またはPDF）に含まれるすべての詰将棋の問題を読み取り、それぞれの盤面の状態と持ち駒からSFEN形式の文字列を作成し、JSONの文字列配列として出力してください。
PDFの場合は複数ページに複数の問題がある可能性があります。すべての問題を抽出してください。

【重要：先手と後手の駒の判定（絶対に間違えないでください）】
画像内の駒の向きで先手・後手を判断します。
1. 先手の駒（攻め方・プレイヤー）:
   - 駒の文字が「正しく（正立して）」読める。
   - 駒の五角形の尖っている方向が「上（奥）」を向いている。
   - SFENでは **大文字** で出力（例: R, B, G, S, N, L, P, +R, +B, +S, +N, +L, +P）。

2. 後手の駒（受け方・玉方）:
   - 駒の文字が「逆さま」になっている。
   - 駒の五角形の尖っている方向が「下（手前）」を向いている。
   - ※詰将棋の「玉」は通常こちらの向きです。
   - SFENでは **小文字** で出力（例: k, r, b, g, s, n, l, p, +r, +b, +s, +n, +l, +p）。

【SFEN形式のルール】
SFEN形式の例: 7nl/1R3sk2/5pppp/9/9/9/9/9/9 b GS 1
・先手の手番として 'b' を指定します。
・持ち駒（先手）は、大文字で指定してください（例: GS）。持ち駒がない場合は '-' を指定してください。（後手の持ち駒は算定されるため無視しても構いませんが、ある場合は小文字で含めます）
・空白は連続するマスの数を数字で表します（1〜9）。

出力は純粋なJSON配列のみにしてください。Markdownのコードブロック（\`\`\`json ... \`\`\`）や余計な説明は一切含めないでください。
例: ["7nl/1R3sk2/5pppp/9/9/9/9/9/9 b GS 1", "3gkr3/9/4S4/9/9/9/9/9/9 b Nr2b3g3s3n4l18p 1"]`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: {
          parts: [
            { text: prompt },
            { inlineData: { data: base64Data, mimeType: file.type } }
          ]
        }
      });

      const responseText = response.text?.trim() || "[]";
      const jsonStr = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      
      let sfens: string[] = [];
      try {
        sfens = JSON.parse(jsonStr);
      } catch (e) {
        if (jsonStr.includes('/') && jsonStr.includes(' ')) {
          sfens = [jsonStr];
        } else {
          throw new Error("SFEN文字列の抽出に失敗しました。");
        }
      }

      if (!sfens || sfens.length === 0) {
        throw new Error("問題が見つかりませんでした。");
      }

      const newProblems: Problem[] = sfens.map((sfen, index) => ({
        id: Date.now() + index,
        title: `追加問題${sfens.length > 1 ? ` (${index + 1})` : ''}`,
        description: 'ファイルから追加された問題です。',
        initialSfen: sfen,
      }));

      setProblems(prev => {
        const updated = [...prev];
        updated.splice(currentProblemIndex + 1, 0, ...newProblems);
        return updated.map((p, i) => ({ ...p, id: i + 1 }));
      });
      setCurrentProblemIndex(currentProblemIndex + 1);
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err: any) {
      console.error("Upload error:", err);
      setUploadError(err.message || "ファイルの読み込みまたは解析に失敗しました。");
    } finally {
      setIsUploading(false);
    }
  };

  const resetGame = useCallback(() => {
    if (!currentProblem) return;
    
    try {
      const newShogi = new Shogi();
      try {
        if (newShogi.initializeFromSFENString) {
          newShogi.initializeFromSFENString(currentProblem.initialSfen);
        } else if (newShogi.initializeFromSFEN) {
          newShogi.initializeFromSFEN(currentProblem.initialSfen);
        }
      } catch (sfenError) {
        console.error("Invalid SFEN:", currentProblem.initialSfen);
        // Initialize with empty board if SFEN is invalid
        if (newShogi.initializeFromSFENString) {
          newShogi.initializeFromSFENString("9/9/9/9/9/9/9/9/9 b - 1");
        } else {
          newShogi.initializeFromSFEN("9/9/9/9/9/9/9/9/9 b - 1");
        }
        setAlertDialog(`問題「${currentProblem.title}」の盤面データが不正なため、空の盤面を表示しています。「盤面を修正」から修正してください。`);
      }
      
      fillGoteHand(newShogi);
      setShogi(newShogi);
      setSelectedSquare(null);
      setSelectedHandPiece(null);
      setMessage('あなたの番です。');
      setIsGameOver(false);
      setMoveHistory([]);
      setError(null);
      setPendingPromotionMove(null);
      setSfenHistory([newShogi.toSFENString ? newShogi.toSFENString(1) : '']);
    } catch (e) {
      console.error("Game initialization error", e);
      setError("ゲームの初期化に失敗しました。");
    }
  }, [currentProblem]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  if (isLoadingProblems) {
    return (
      <div className="min-h-screen bg-[#fdf6e3] flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-amber-800 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-amber-800 font-bold">問題データを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#fdf6e3] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl border border-red-100 text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-amber-950 mb-2">エラーが発生しました</h1>
          <p className="text-amber-800/70 mb-6">{error}</p>
          <div className="flex flex-col gap-3">
            <button onClick={() => window.location.reload()} className="bg-amber-800 text-white px-6 py-2 rounded-xl font-bold hover:bg-amber-900 transition-colors">
              再読み込み
            </button>
            <button
              onClick={() => {
                localStorage.removeItem('tsumeShogiProblems');
                fetch('/api/problems', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(INITIAL_PROBLEMS)
                }).then(() => window.location.reload());
              }}
              className="px-6 py-2 bg-red-50 text-red-600 rounded-xl font-bold hover:bg-red-100 transition-colors text-sm"
            >
              データを初期化して復旧する
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!shogi) {
    return (
      <div className="min-h-screen bg-[#fdf6e3] flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-amber-800 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-amber-800 font-bold">読み込み中...</p>
        </div>
      </div>
    );
  }

  const handleSquareClick = (x: number, y: number) => {
    if (isEditMode) {
      if (editTool === 'eraser') {
        shogi.board[x - 1][y - 1] = null;
      } else if (editTool) {
        const prefix = editTool.color === Color.Black ? '+' : '-';
        shogi.board[x - 1][y - 1] = new Piece(prefix + editTool.kind);
      } else {
        if (selectedSquare) {
          if (selectedSquare.x === x && selectedSquare.y === y) {
            // Flip color if the same piece is clicked again
            const piece = shogi.get(x, y);
            if (piece) {
              shogi.board[x - 1][y - 1] = new Piece(piece.color === Color.Black ? '-' + piece.kind : '+' + piece.kind);
            }
            setSelectedSquare(null);
          } else {
            // Swap piece to the new square (moving it if empty, swapping if occupied)
            const pieceToMove = shogi.get(selectedSquare.x, selectedSquare.y);
            const targetPiece = shogi.get(x, y);
            shogi.board[selectedSquare.x - 1][selectedSquare.y - 1] = targetPiece;
            shogi.board[x - 1][y - 1] = pieceToMove;
            setSelectedSquare(null);
          }
        } else {
          // Select piece to move or flip
          if (shogi.get(x, y)) {
            setSelectedSquare({ x, y });
          }
          return; // Wait for the next click
        }
      }
      fillGoteHand(shogi);
      setShogi(cloneShogi(shogi));
      return;
    }

    if (isGameOver || pendingPromotionMove || message === '相手が考えています...') return;

    if (selectedHandPiece) {
      const to = { x, y };
      processMove({ to, piece: selectedHandPiece.piece });
      setSelectedHandPiece(null);
      return;
    }

    if (selectedSquare) {
      if (selectedSquare.x === x && selectedSquare.y === y) {
        setSelectedSquare(null);
        return;
      }

      const piece = shogi.get(selectedSquare.x, selectedSquare.y);
      if (!piece) {
        setSelectedSquare(null);
        return;
      }

      const move: Move = { from: selectedSquare, to: { x, y }, promote: false };
      
      const isPromotionZone = (color: Color, row: number) => color === Color.Black ? row <= 3 : row >= 7;
      const isPromoted = ["TO", "NY", "NK", "NG", "UM", "RY"].includes(piece.kind);
      const canPromote = !isPromoted && 
                         !['KI', 'OU', 'GY'].includes(piece.kind) &&
                         (isPromotionZone(piece.color, selectedSquare.y) || isPromotionZone(piece.color, y));
                         
      const mustPromote = canPromote && (
        (['FU', 'KY'].includes(piece.kind) && (piece.color === Color.Black ? y === 1 : y === 9)) ||
        (piece.kind === 'KE' && (piece.color === Color.Black ? y <= 2 : y >= 8))
      );

      if (mustPromote) {
        move.promote = true;
        processMove(move);
        setSelectedSquare(null);
      } else if (canPromote) {
        setPendingPromotionMove(move);
      } else {
        processMove(move);
        setSelectedSquare(null);
      }
    } else {
      // Select a piece on the board
      const piece = shogi.get(x, y);
      if (piece && piece.color === Color.Black) {
        setSelectedSquare({ x, y });
      }
    }
  };

  const handleHandClick = (piece: string, color: Color) => {
    if (isGameOver || color !== Color.Black || message === '相手が考えています...') return;
    setSelectedSquare(null);
    setSelectedHandPiece({ piece, color });
  };

  const processMove = (move: Move) => {
    setPendingPromotionMove(null);
    const sfenBefore = shogi.toSFENString(1);

    const legalMoves = getLegalMoves(shogi, Color.Black);
    const isLegal = legalMoves.some(m => 
      m.from?.x === move.from?.x && m.from?.y === move.from?.y &&
      m.to?.x === move.to.x && m.to?.y === move.to.y &&
      m.piece === move.piece && m.promote === move.promote
    );

    if (!isLegal) {
      setMessage('その手は指せません（反則手です）。');
      setTimeout(() => setMessage('あなたの番です。'), 1500);
      return;
    }

    const tempShogi = cloneShogi(shogi);
    applyMoveToShogi(tempShogi, move);
    if (!tempShogi.isCheck(Color.White)) {
      setMessage('王手ではありません。');
      setTimeout(() => setMessage('あなたの番です。'), 1500);
      return;
    }

    applyMoveToShogi(shogi, move);

    if (move.piece === 'FU') {
      const whiteMoves = getLegalMoves(shogi, Color.White);
      if (whiteMoves.length === 0) {
        shogi.initializeFromSFENString(sfenBefore);
        setMessage('打ち歩詰めは禁手です。');
        setTimeout(() => setMessage('あなたの番です。'), 2000);
        return;
      }
    }

    const newSfen = shogi.toSFENString(1);
    
    const count = sfenHistory.filter(s => s === newSfen).length;
    if (count >= 3) {
      setSfenHistory(prev => [...prev, newSfen]);
      setMoveHistory(prev => [...prev, move]);
      setShogi(cloneShogi(shogi));
      setIsGameOver(true);
      setMessage('千日手です。攻め方の失敗となります。');
      return;
    }

    setSfenHistory(prev => [...prev, newSfen]);
    setMoveHistory(prev => [...prev, move]);
    
    const nextShogi = cloneShogi(shogi);
    setShogi(nextShogi);

    const whiteMoves = getLegalMoves(nextShogi, Color.White);
    if (whiteMoves.length === 0) {
      setIsGameOver(true);
      setMessage('詰みです！おめでとうございます！');
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 }
      });
      return;
    }

    setMessage('相手が考えています...');
    
    setTimeout(() => {
      const sfenKey = nextShogi.toSFENString(1);
      const defenderRes = findBestDefenderMove(nextShogi, 3, aiMoveHistoryMap);
      
      if (defenderRes.bestMove) {
        setAiMoveHistoryMap(prev => ({ ...prev, [sfenKey]: defenderRes.bestMove! }));
        applyMoveToShogi(nextShogi, defenderRes.bestMove);
        const afterGoteSfen = nextShogi.toSFENString(1);
        setSfenHistory(prev => [...prev, afterGoteSfen]);
        setMoveHistory(prev => [...prev, defenderRes.bestMove!]);
        
        const blackMoves = getLegalMoves(nextShogi, Color.Black);
        if (blackMoves.length === 0) {
          setIsGameOver(true);
          setMessage('指す手がありません。失敗です。');
        } else {
          setMessage('あなたの番です。');
        }
        setShogi(cloneShogi(nextShogi));
      } else {
        setIsGameOver(true);
        setMessage('詰みです！おめでとうございます！');
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 }
        });
      }
    }, 50);
  };

  const renderBoard = () => {
    const cells = [];
    for (let y = 1; y <= 9; y++) {
      for (let x = 9; x >= 1; x--) {
        const piece = shogi.get(x, y);
        const isSelected = selectedSquare?.x === x && selectedSquare?.y === y;
        const lastMove = moveHistory[moveHistory.length - 1];
        const isLastMove = lastMove?.to.x === x && lastMove?.to.y === y;

        cells.push(
          <div
            key={`${x}-${y}`}
            onClick={() => handleSquareClick(x, y)}
            className={`
              relative w-full aspect-square border border-amber-800/30 flex items-center justify-center cursor-pointer
              ${isSelected ? 'bg-amber-400/50' : isLastMove ? 'bg-amber-200/40' : 'hover:bg-amber-100/30'}
              transition-colors duration-200
            `}
          >
            {piece && (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className={`
                  text-2xl sm:text-3xl font-bold select-none
                  ${piece.color === Color.White ? 'rotate-180 text-amber-900' : 'text-amber-950'}
                `}
              >
                {PIECE_NAMES[piece.kind] || piece.kind}
              </motion.div>
            )}
            {/* Coordinates for edge cells */}
            {y === 1 && <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs text-amber-800/60 font-mono">{x}</span>}
            {x === 1 && <span className="absolute top-1/2 -right-6 -translate-y-1/2 text-xs text-amber-800/60 font-mono">{['一', '二', '三', '四', '五', '六', '七', '八', '九'][y - 1]}</span>}
          </div>
        );
      }
    }
    return cells;
  };

  const renderHand = (color: Color) => {
    const hand = shogi.getHandsSummary(color);
    const HAND_PIECES = ['FU', 'KY', 'KE', 'GI', 'KI', 'KA', 'HI'];
    const pieces = isEditMode && color === Color.Black
      ? HAND_PIECES.map(kind => [kind, hand[kind] || 0])
      : Object.entries(hand).filter(([_, count]) => (count as number) > 0);

    return (
      <div className="flex flex-col flex-wrap gap-1 sm:gap-2 items-center justify-center">
        {!isEditMode && pieces.length === 0 && <span className="text-amber-800/40 text-[10px] sm:text-sm italic py-2">なし</span>}
        {pieces.map(([kind, count]) => (
          <div key={kind} className="flex flex-col items-center gap-1">
            <div
              onClick={() => !isEditMode && handleHandClick(kind as string, color)}
              className={`
                relative w-8 h-8 sm:w-12 sm:h-12 flex items-center justify-center border border-amber-800/30 rounded
                ${!isEditMode ? 'cursor-pointer' : ''}
                ${selectedHandPiece?.piece === kind && selectedHandPiece?.color === color ? 'bg-amber-400/50' : 'bg-white/80 hover:bg-amber-100'}
                transition-all duration-200 shadow-sm
              `}
            >
              <span className={`text-lg sm:text-2xl font-bold ${color === Color.White ? 'rotate-180 text-amber-900' : 'text-amber-950'} ${isEditMode && color === Color.Black && count === 0 ? 'opacity-30' : ''}`}>
                {PIECE_NAMES[kind as string] || kind}
              </span>
              {(count as number) > 1 && (
                <span className="absolute -bottom-1 -right-1 bg-amber-800 text-white text-[10px] sm:text-xs w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center rounded-full border border-white">
                  {count as number}
                </span>
              )}
            </div>
            {isEditMode && color === Color.Black && (
              <div className="flex gap-1">
                <button 
                  onClick={() => {
                    if ((count as number) > 0) {
                      shogi.popFromHand(kind as string, color);
                      fillGoteHand(shogi);
                      setShogi(cloneShogi(shogi));
                    }
                  }}
                  className="w-5 h-5 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded text-xs font-bold"
                >-</button>
                <button 
                  onClick={() => {
                    shogi.pushToHand(new Piece('+' + kind));
                    fillGoteHand(shogi);
                    setShogi(cloneShogi(shogi));
                  }}
                  className="w-5 h-5 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded text-xs font-bold"
                >+</button>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#fdf6e3] text-amber-950 font-sans p-4 sm:p-8 flex flex-col items-center">
      {/* Custom Modals */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl shadow-xl max-w-sm w-full mx-4">
            <p className="text-lg font-bold mb-6">{confirmDialog.message}</p>
            <div className="flex justify-end gap-4">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
                className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {alertDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl shadow-xl max-w-sm w-full mx-4">
            <p className="text-lg font-bold mb-6">{alertDialog}</p>
            <div className="flex justify-end">
              <button
                onClick={() => setAlertDialog(null)}
                className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="w-full max-w-4xl flex flex-col sm:flex-row justify-between items-center mb-8 gap-4">
        <div>
          {isEditingTitle ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={tempTitle}
                onChange={(e) => setTempTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTitleSave();
                  if (e.key === 'Escape') setIsEditingTitle(false);
                }}
                className="text-3xl font-black tracking-tight text-amber-900 bg-white border-2 border-amber-300 rounded-lg px-2 py-1 outline-none focus:border-amber-500 w-full max-w-[300px]"
                autoFocus
                onBlur={handleTitleSave}
              />
            </div>
          ) : (
            <h1 
              className="text-3xl font-black tracking-tight text-amber-900 flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => {
                setTempTitle(appTitle);
                setIsEditingTitle(true);
              }}
              title="クリックしてタイトルを編集"
            >
              {appTitle}
              <Trophy className="text-amber-600 w-6 h-6" />
              <Edit2 className="w-4 h-4 text-amber-900/40 ml-2" />
            </h1>
          )}
          <p className="text-amber-800/70 text-sm">Shogi Puzzle Master</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentProblemIndex(prev => Math.max(0, prev - 1))}
              disabled={currentProblemIndex === 0}
              className="p-2 rounded-full hover:bg-amber-200 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft />
            </button>
            <span className="font-bold px-4 py-1 bg-amber-200 rounded-full text-sm">
              問題 {currentProblem.id} / {problems.length}
            </span>
            <button
              onClick={() => setCurrentProblemIndex(prev => Math.min(problems.length - 1, prev + 1))}
              disabled={currentProblemIndex === problems.length - 1}
              className="p-2 rounded-full hover:bg-amber-200 disabled:opacity-30 transition-colors"
            >
              <ChevronRight />
            </button>
          </div>
          {problems.length > INITIAL_PROBLEMS.length && (
            <button
              onClick={() => {
                setConfirmDialog({
                  message: '追加した問題をすべて削除して初期状態に戻しますか？',
                  onConfirm: () => {
                    setProblems(INITIAL_PROBLEMS);
                    setCurrentProblemIndex(0);
                  }
                });
              }}
              className="text-xs text-red-600 hover:text-red-800 underline"
            >
              初期化
            </button>
          )}
        </div>
      </header>

      <main className="w-full max-w-5xl flex flex-col lg:flex-row gap-8 items-start justify-center">
        {/* Info Column */}
        <div className="w-full lg:w-1/3 space-y-6 order-2 lg:order-1">
          <section className="bg-white/60 p-6 rounded-2xl border border-amber-200 shadow-sm">
            <h2 className="text-xl font-bold mb-2 flex items-center gap-2 flex-wrap">
              {currentProblem.title}
              <button onClick={() => setShowInfo(!showInfo)} className="text-amber-600 hover:text-amber-800" title="ヒント">
                <Info size={18} />
              </button>
              <button onClick={moveProblemUp} disabled={currentProblemIndex === 0} className="p-1 text-amber-600 hover:bg-amber-200 rounded disabled:opacity-30" title="前に移動"><ArrowUp size={16} /></button>
              <button onClick={moveProblemDown} disabled={currentProblemIndex === problems.length - 1} className="p-1 text-amber-600 hover:bg-amber-200 rounded disabled:opacity-30" title="後ろに移動"><ArrowDown size={16} /></button>
              <button onClick={renumberProblems} className="p-1 text-amber-600 hover:bg-amber-200 rounded" title="問題番号を順番通りに振り直す"><ListOrdered size={16} /></button>
              <button onClick={duplicateProblem} className="p-1 text-amber-600 hover:bg-amber-200 rounded" title="この問題を複製"><Copy size={16} /></button>
              <button onClick={deleteProblem} className="p-1 text-red-500 hover:bg-red-100 rounded" title="この問題を削除"><Trash2 size={16} /></button>
              <button 
                onClick={toggleEditMode}
                className={`flex items-center gap-1 text-sm px-2 py-1 rounded transition-colors ${isEditMode ? 'bg-amber-600 text-white' : 'bg-amber-200 text-amber-800 hover:bg-amber-300'}`}
                title="盤面を編集する"
              >
                {isEditMode ? <Check size={14} /> : <Edit2 size={14} />}
                {isEditMode ? '編集完了' : '盤面を修正'}
              </button>
            </h2>
            {isEditMode ? (
              <textarea
                value={currentProblem.description}
                onChange={(e) => {
                  const updatedProblems = [...problems];
                  updatedProblems[currentProblemIndex] = {
                    ...currentProblem,
                    description: e.target.value,
                  };
                  setProblems(updatedProblems);
                }}
                className="w-full p-3 border border-amber-300 rounded-xl bg-white text-amber-900 mb-4 focus:outline-none focus:ring-2 focus:ring-amber-500"
                rows={3}
                placeholder="問題の説明を入力してください"
              />
            ) : (
              <p className="text-amber-800 mb-4 leading-relaxed whitespace-pre-wrap">
                {currentProblem.description}
              </p>
            )}
            
            <div className={`
              p-4 rounded-xl text-center font-bold text-lg transition-all duration-300
              ${isGameOver ? 'bg-green-100 text-green-800 scale-105' : 'bg-amber-100 text-amber-900'}
            `}>
              {message}
            </div>
          </section>

          <AnimatePresence>
            {showInfo && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-sm text-blue-800"
              >
                <p><strong>ヒント:</strong> 相手の玉を逃げ場のない状態（詰み）にしてください。王手（玉を直接狙う手）を続ける必要があります。</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Board Area */}
        <div className="w-full lg:w-2/3 flex flex-col gap-4 order-1 lg:order-2 items-center">
          <div className="w-full flex flex-row justify-center items-stretch gap-1 sm:gap-4">
            
            {/* Gote Hand (Left) - Hidden as per Tsume Shogi rules (has all remaining pieces) */}
            <div className="w-12 sm:w-16 md:w-24 flex flex-col justify-start">
            </div>

            {/* Board */}
            <div className="flex flex-col items-center gap-4">
              <div className={`relative p-2 sm:p-6 rounded-lg shadow-2xl border-4 flex-shrink-0 transition-colors ${isEditMode ? 'bg-amber-100 border-amber-500' : 'bg-amber-200 border-amber-800/20'}`}>
                {isEditMode && (
                  <div className="absolute top-0 left-0 right-0 bg-amber-500 text-white text-xs font-bold text-center py-1 rounded-t-sm z-10">
                    盤面編集モード
                  </div>
                )}
                <div className={`grid grid-cols-9 w-[260px] sm:w-[380px] md:w-[420px] bg-amber-50 border-2 border-amber-900 shadow-inner ${isEditMode ? 'mt-4' : ''}`}>
                  {renderBoard()}
                </div>
              </div>
              
              <button
                onClick={resetGame}
                className="w-full max-w-[260px] sm:max-w-[380px] md:max-w-[420px] flex items-center justify-center gap-2 bg-amber-800 text-white py-3 rounded-xl font-bold hover:bg-amber-900 transition-colors shadow-md active:scale-95"
              >
                <RotateCcw size={18} />
                最初から
              </button>
            </div>

            {/* Sente Hand (Right) */}
            <div className="w-12 sm:w-16 md:w-24 flex flex-col justify-end">
              <div className="bg-amber-900/5 p-1 sm:p-3 rounded-xl border border-amber-900/10 min-h-[80px] h-full flex flex-col">
                <div className="flex-1 flex flex-col justify-end">
                  {renderHand(Color.Black)}
                </div>
                <h3 className="text-[10px] sm:text-xs font-bold text-amber-900/60 mt-2 text-center">先手</h3>
              </div>
            </div>

          </div>

          {/* Edit Palette */}
          {isEditMode && (
            <div className="w-full max-w-[600px] bg-white/80 p-4 rounded-xl border border-amber-300 shadow-sm">
              <h3 className="font-bold text-amber-900 mb-2">盤面編集ツール</h3>
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={() => setEditTool('eraser')}
                  className={`px-3 py-1 rounded border text-sm ${editTool === 'eraser' ? 'bg-amber-400 border-amber-600 font-bold' : 'bg-white hover:bg-amber-100'}`}
                >
                  消しゴム
                </button>
                <button
                  onClick={() => {
                    setEditTool(null);
                    setSelectedSquare(null);
                  }}
                  className={`px-3 py-1 rounded border text-sm ${editTool === null ? 'bg-amber-400 border-amber-600 font-bold' : 'bg-white hover:bg-amber-100'}`}
                >
                  移動 / 反転
                </button>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <div className="text-xs font-bold mb-1 text-amber-900">先手（黒）の駒を配置</div>
                  <div className="flex flex-wrap gap-1">
                    {['FU', 'KY', 'KE', 'GI', 'KI', 'KA', 'HI', 'OU', 'TO', 'NY', 'NK', 'NG', 'UM', 'RY'].map(kind => (
                      <button
                        key={`black-${kind}`}
                        onClick={() => setEditTool({ kind, color: Color.Black })}
                        className={`w-8 h-8 flex items-center justify-center border rounded text-sm ${editTool !== 'eraser' && editTool?.kind === kind && editTool?.color === Color.Black ? 'bg-amber-400 border-amber-600 font-bold' : 'bg-white hover:bg-amber-100'}`}
                      >
                        {PIECE_NAMES[kind]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="text-xs font-bold mb-1 text-amber-900">後手（白）の駒を配置</div>
                  <div className="flex flex-wrap gap-1">
                    {['FU', 'KY', 'KE', 'GI', 'KI', 'KA', 'HI', 'OU', 'TO', 'NY', 'NK', 'NG', 'UM', 'RY'].map(kind => (
                      <button
                        key={`white-${kind}`}
                        onClick={() => setEditTool({ kind, color: Color.White })}
                        className={`w-8 h-8 flex items-center justify-center border rounded text-sm ${editTool !== 'eraser' && editTool?.kind === kind && editTool?.color === Color.White ? 'bg-amber-400 border-amber-600 font-bold' : 'bg-white hover:bg-amber-100'}`}
                      >
                        <span className="rotate-180">{PIECE_NAMES[kind]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Upload Section */}
      <div className="w-full max-w-5xl mt-8">
        <div className="bg-white/60 p-4 rounded-xl border border-amber-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 text-amber-900 w-full sm:w-auto">
            <div className="flex items-center gap-2">
              <Upload size={20} />
              <span className="font-bold text-sm">問題を追加・エクスポートする</span>
            </div>
            
            <button
              onClick={copyAllData}
              className="flex items-center gap-2 text-sm text-amber-700 hover:text-amber-900 bg-white px-3 py-1.5 rounded-md border border-amber-300 shadow-sm transition-colors"
            >
              <ClipboardCopy size={16} />
              データをコピー
            </button>
          </div>
          <div className="flex items-center gap-4 w-full sm:w-auto">
            <button
              onClick={handleAddEmptyProblem}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-amber-100 text-amber-900 px-4 py-2 rounded-lg font-bold hover:bg-amber-200 transition-colors"
            >
              <Plus size={18} />
              空の盤面を追加
            </button>
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              ref={fileInputRef}
              onChange={handleImageUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-amber-100 text-amber-900 px-4 py-2 rounded-lg font-bold hover:bg-amber-200 transition-colors disabled:opacity-50"
            >
              {isUploading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Upload size={18} />
              )}
              {isUploading ? '解析中...' : '画像/PDFから追加'}
            </button>
          </div>
        </div>
        {uploadError && (
          <div className="mt-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg border border-red-100 flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}
      </div>

      {/* Promotion Dialog */}
      <AnimatePresence>
        {pendingPromotionMove && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center gap-6 max-w-sm w-full"
            >
              <h3 className="text-2xl font-bold text-amber-900">成りますか？</h3>
              <div className="flex gap-4 w-full">
                <button
                  onClick={() => {
                    const move = { ...pendingPromotionMove, promote: true };
                    processMove(move);
                    setSelectedSquare(null);
                  }}
                  className="flex-1 py-4 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700 transition-colors text-lg shadow-md"
                >
                  成る
                </button>
                <button
                  onClick={() => {
                    const move = { ...pendingPromotionMove, promote: false };
                    processMove(move);
                    setSelectedSquare(null);
                  }}
                  className="flex-1 py-4 bg-gray-200 text-gray-800 font-bold rounded-xl hover:bg-gray-300 transition-colors text-lg shadow-md"
                >
                  成らず
                </button>
              </div>
              <button
                onClick={() => {
                  setPendingPromotionMove(null);
                  setSelectedSquare(null);
                }}
                className="text-sm text-gray-500 hover:text-gray-700 underline mt-2"
              >
                キャンセル
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="mt-12 text-amber-800/40 text-xs">
        © 2026 {appTitle} • 伝統的な将棋のパズル
      </footer>
    </div>
  );
}
