import type { PlayerState } from "./data";
import { isFinished, parseScore, teamName, type ApiGame } from "./worldcup";

export function matchPoints(prediction: { home: number; away: number }, game: ApiGame) {
  if (!isFinished(game)) return 0;

  const actualHome = parseScore(game.home_score);
  const actualAway = parseScore(game.away_score);

  // 1. Fully correct score (e.g. 2-1 vs 2-1) -> 5 pts
  if (prediction.home === actualHome && prediction.away === actualAway) {
    return 5;
  }

  const predictedDiff = prediction.home - prediction.away;
  const actualDiff = actualHome - actualAway;
  const predictedSign = Math.sign(predictedDiff);
  const actualSign = Math.sign(actualDiff);

  const correctSign = predictedSign === actualSign;

  if (correctSign) {
    // It's a draw, but different goals (e.g. 1-1 vs 2-2) -> 2 pts
    if (actualSign === 0) {
      return 2;
    }
    // Correct diff and sign (e.g. 2-1 vs 3-2) -> 3 pts
    if (predictedDiff === actualDiff) {
      return 3;
    }
    // Correct sign, incorrect diff (e.g. 1-0 vs 3-1) -> 2 pts
    return 2;
  }

  // Incorrect sign (tulos väärin) but one of the team's goals was correct -> 1 pt
  if (prediction.home === actualHome || prediction.away === actualAway) {
    return 1;
  }

  return 0;
}

export function standings(players: PlayerState[], games: ApiGame[]) {
  return players
    .map((player) => {
      const matchTotal = player.predictions.reduce((sum, prediction) => {
        const game = games.find((item) => item.id === prediction.matchId);
        return sum + (game ? matchPoints(prediction, game) : 0);
      }, 0);

      return {
        name: player.name,
        points: matchTotal,
        exact: player.predictions.filter((prediction) => {
          const game = games.find((item) => item.id === prediction.matchId);
          return game ? matchPoints(prediction, game) === 5 : false;
        }).length,
      };
    })
    .sort((a, b) => b.points - a.points || b.exact - a.exact || a.name.localeCompare(b.name));
}

export function describeMatch(game: ApiGame) {
  return `${teamName(game, "home")} - ${teamName(game, "away")}`;
}
