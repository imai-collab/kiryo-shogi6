import * as ShogiModule from 'shogi.js';

const Shogi = (ShogiModule as any).Shogi || (ShogiModule as any).default?.Shogi || (ShogiModule as any).default;
const Color = (ShogiModule as any).Color || (ShogiModule as any).default?.Color || { Black: 0, White: 1 };

export interface Position {
  x: number;
  y: number;
}

export interface Move {
  from?: Position;
  to: Position;
  piece?: string;
  promote?: boolean;
}

export function solveTsumeShogi(sfen: string, maxDepth: number): Move[] | null {
    const shogi = new Shogi();
    try {
        if (shogi.initializeFromSFENString) {
            shogi.initializeFromSFENString(sfen);
        } else {
            shogi.initializeFromSFEN(sfen);
        }
    } catch (e) {
        console.error("Invalid SFEN:", sfen);
        return null;
    }

    function search(depth: number, isBlackTurn: boolean): any {
        if (depth === 0) {
            // Check if it's checkmate
            const checkColor = isBlackTurn ? Color.White : Color.Black;
            const checkMoves = [];
            for (let x = 1; x <= 9; x++) {
                for (let y = 1; y <= 9; y++) {
                    const p = shogi.board[x - 1][y - 1];
                    if (p && p.color === checkColor) {
                        checkMoves.push(...shogi.getMovesFrom(x, y));
                    }
                }
            }
            const checkDrops = shogi.getDropsBy(checkColor);
            for (const d of checkDrops) {
                for (let x = 1; x <= 9; x++) {
                    for (let y = 1; y <= 9; y++) {
                        if (!shogi.board[x - 1][y - 1]) {
                            checkMoves.push({ to: { x, y }, piece: d.kind, color: checkColor });
                        }
                    }
                }
            }
            const checkLegalMoves = checkMoves.filter((wm: any) => {
                const ws = shogi.toSFENString ? shogi.toSFENString(1) : shogi.toSFEN(1);
                try {
                    if (wm.from) shogi.move(wm.from.x, wm.from.y, wm.to.x, wm.to.y, wm.promote);
                    else shogi.drop(wm.to.x, wm.to.y, wm.piece);
                    const isLegal = !shogi.isCheck(checkColor);
                    if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(ws);
                    else shogi.initializeFromSFEN(ws);
                    return isLegal;
                } catch (e) {
                    if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(ws);
                    else shogi.initializeFromSFEN(ws);
                    return false;
                }
            });
            return checkLegalMoves.length === 0 ? [] : null;
        }

        const color = isBlackTurn ? Color.Black : Color.White;
        const moves: any[] = [];
        for (let x = 1; x <= 9; x++) {
            for (let y = 1; y <= 9; y++) {
                const p = shogi.board[x - 1][y - 1];
                if (p && p.color === color) {
                    moves.push(...shogi.getMovesFrom(x, y));
                }
            }
        }
        const drops = shogi.getDropsBy(color);
        for (const d of drops) {
            for (let x = 1; x <= 9; x++) {
                for (let y = 1; y <= 9; y++) {
                    if (!shogi.board[x - 1][y - 1]) {
                        moves.push({ to: { x, y }, piece: d.kind, color: color });
                    }
                }
            }
        }

        const legalMoves = moves.filter(m => {
            const s = shogi.toSFENString ? shogi.toSFENString(1) : shogi.toSFEN(1);
            try {
                if (m.from) {
                    shogi.move(m.from.x, m.from.y, m.to.x, m.to.y, m.promote);
                } else {
                    shogi.drop(m.to.x, m.to.y, m.piece);
                }
                const isLegal = !shogi.isCheck(color);
                if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(s);
                else shogi.initializeFromSFEN(s);
                return isLegal;
            } catch (e) {
                if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(s);
                else shogi.initializeFromSFEN(s);
                return false;
            }
        });

        if (isBlackTurn) {
            const checkMoves = legalMoves.filter(m => {
                const s = shogi.toSFENString ? shogi.toSFENString(1) : shogi.toSFEN(1);
                if (m.from) shogi.move(m.from.x, m.from.y, m.to.x, m.to.y, m.promote);
                else shogi.drop(m.to.x, m.to.y, m.piece);
                const isCheck = shogi.isCheck(Color.White);
                if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(s);
                else shogi.initializeFromSFEN(s);
                return isCheck;
            });

            for (const m of checkMoves) {
                const s = shogi.toSFENString ? shogi.toSFENString(1) : shogi.toSFEN(1);
                if (m.from) shogi.move(m.from.x, m.from.y, m.to.x, m.to.y, m.promote);
                else shogi.drop(m.to.x, m.to.y, m.piece);
                
                // Check if it's checkmate by seeing if White has any legal moves
                const whiteMoves = [];
                for (let x = 1; x <= 9; x++) {
                    for (let y = 1; y <= 9; y++) {
                        const p = shogi.board[x - 1][y - 1];
                        if (p && p.color === Color.White) {
                            whiteMoves.push(...shogi.getMovesFrom(x, y));
                        }
                    }
                }
                const whiteDrops = shogi.getDropsBy(Color.White);
                for (const d of whiteDrops) {
                    for (let x = 1; x <= 9; x++) {
                        for (let y = 1; y <= 9; y++) {
                            if (!shogi.board[x - 1][y - 1]) {
                                whiteMoves.push({ to: { x, y }, piece: d.kind, color: Color.White });
                            }
                        }
                    }
                }
                const whiteLegalMoves = whiteMoves.filter((wm: any) => {
                    const ws = shogi.toSFENString ? shogi.toSFENString(1) : shogi.toSFEN(1);
                    try {
                        if (wm.from) shogi.move(wm.from.x, wm.from.y, wm.to.x, wm.to.y, wm.promote);
                        else shogi.drop(wm.to.x, wm.to.y, wm.piece);
                        const isLegal = !shogi.isCheck(Color.White);
                        if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(ws);
                        else shogi.initializeFromSFEN(ws);
                        return isLegal;
                    } catch (e) {
                        if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(ws);
                        else shogi.initializeFromSFEN(ws);
                        return false;
                    }
                });

                if (whiteLegalMoves.length === 0) {
                    if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(s);
                    else shogi.initializeFromSFEN(s);
                    return [m];
                }

                const res = search(depth - 1, false);
                if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(s);
                else shogi.initializeFromSFEN(s);
                if (res) {
                    return [m, ...res];
                }
            }
            return null;
        } else {
            if (legalMoves.length === 0) return [];
            
            let bestRes = null;
            let allMate = true;
            for (const m of legalMoves) {
                const s = shogi.toSFENString ? shogi.toSFENString(1) : shogi.toSFEN(1);
                if (m.from) shogi.move(m.from.x, m.from.y, m.to.x, m.to.y, m.promote);
                else shogi.drop(m.to.x, m.to.y, m.piece);
                
                const res = search(depth - 1, true);
                if (shogi.initializeFromSFENString) shogi.initializeFromSFENString(s);
                else shogi.initializeFromSFEN(s);
                
                if (!res) {
                    allMate = false;
                    break;
                }
                if (!bestRes || res.length > bestRes.length) {
                    bestRes = [m, ...res];
                }
            }
            return allMate ? bestRes : null;
        }
    }

    return search(maxDepth, true);
}
