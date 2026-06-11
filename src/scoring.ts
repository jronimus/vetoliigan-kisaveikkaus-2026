import type { PlayerState } from "./data";
import { isFinished, parseScore, teamName, type ApiGame } from "./worldcup";

export function matchPoints(prediction: { home: number; away: number }, game: ApiGame) {
  if (!isFinished(game)) return 0;

  const actualHome = parseScore(game.home_score);
  const actualAway = parseScore(game.away_score);
  const predictedDiff = prediction.home - prediction.away;
  const actualDiff = actualHome - actualAway;

  if (prediction.home === actualHome && prediction.away === actualAway) return 5;
  if (predictedDiff === actualDiff && Math.sign(predictedDiff) === Math.sign(actualDiff)) return 3;
  if (Math.sign(predictedDiff) === Math.sign(actualDiff) && Math.sign(actualDiff) !== 0) return 2;
  if (predictedDiff === 0 && actualDiff === 0) return 1;
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
