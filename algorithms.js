const algorithmList = [
  {
    name: "Random",
    dataDriven: false,
    fn: (seedStr, numMines, totalTiles, revealedIndices, simulations) => {
      const arr = Array(totalTiles).fill(0);
      for (let i = 0; i < arr.length; i++) if (!revealedIndices.includes(i)) arr[i] = Math.random();
      return arr;
    }
  },
  {
    name: "MCTS",
    dataDriven: false,
    fn: (seedStr, numMines, totalTiles, revealedIndices, simulations) => {
      const scores = Array(totalTiles).fill(0);
      for (let i = 0; i < simulations; i++) {
        const idx = Math.floor(Math.random() * totalTiles);
        if (!revealedIndices.includes(idx)) scores[idx] += 1;
      }
      return scores;
    }
  },
  {
    name: "Minimax",
    dataDriven: false,
    fn: (seedStr, numMines, totalTiles, revealedIndices) => {
      const scores = Array(totalTiles).fill(0);
      for (let i = 0; i < totalTiles; i++) if (!revealedIndices.includes(i)) scores[i] = 1 / (i+1);
      return scores;
    }
  },
  {
    name: "Expectimax",
    dataDriven: false,
    fn: (seedStr, numMines, totalTiles, revealedIndices) => {
      const scores = Array(totalTiles).fill(0);
      for (let i = 0; i < totalTiles; i++) if (!revealedIndices.includes(i)) scores[i] = Math.random() * (1 - i/totalTiles);
      return scores;
    }
  },
  {
    name: "PUCT",
    dataDriven: true,
    fn: (seedStr, numMines, totalTiles, revealedIndices, simulations, collectedGames) => {
      if (collectedGames.length < 50) return Array(totalTiles).fill(Math.random());
      const scores = Array(totalTiles).fill(0);
      for (let i = 0; i < totalTiles; i++) {
        if (!revealedIndices.includes(i)) {
          let success = 0, total = 0;
          collectedGames.forEach(g => {
            if (g.prediction && g.prediction[i]) { total++; if (g.success && g.prediction[i]==='✅') success++; }
          });
          const prior = total ? success/total : 0.5;
          scores[i] = prior + Math.sqrt(Math.log(totalTiles+1)/(total+1));
        }
      }
      return scores;
    }
  },
  {
    name: "Frequency Safe",
    dataDriven: true,
    fn: (seedStr, numMines, totalTiles, revealedIndices, simulations, collectedGames) => {
      if (collectedGames.length < 50) return Array(totalTiles).fill(Math.random());
      const freq = Array(totalTiles).fill(0);
      collectedGames.forEach(g => {
        if (g.prediction) g.prediction.forEach((p, idx) => { if (p==='💣') freq[idx]++; });
      });
      return freq.map(f => 1 - (f / collectedGames.length));
    }
  },
  {
    name: "Weighted Success",
    dataDriven: true,
    fn: (seedStr, numMines, totalTiles, revealedIndices, simulations, collectedGames) => {
      if (collectedGames.length < 50) return Array(totalTiles).fill(Math.random());
      const scores = Array(totalTiles).fill(0);
      collectedGames.forEach(g => {
        if (g.prediction && g.success) g.prediction.forEach((p, idx) => { if (p==='✅') scores[idx]++; });
      });
      return scores.map(s => s / collectedGames.length);
    }
  },
  {
    name: "Position Pattern",
    dataDriven: true,
    fn: (seedStr, numMines, totalTiles, revealedIndices, simulations, collectedGames) => {
      if (collectedGames.length < 50) return Array(totalTiles).fill(Math.random());
      const scores = Array(totalTiles).fill(0);
      for (let i = 0; i < totalTiles; i++) {
        let safeCount = 0;
        collectedGames.forEach(g => { if (g.prediction && g.prediction[i]==='✅') safeCount++; });
        scores[i] = safeCount / collectedGames.length;
      }
      return scores;
    }
  },
  {
    name: "Hybrid Data-Driven",
    dataDriven: true,
    fn: (seedStr, numMines, totalTiles, revealedIndices, simulations, collectedGames) => {
      if (collectedGames.length < 50) return Array(totalTiles).fill(Math.random());
      const freq = Array(totalTiles).fill(0);
      const weights = Array(totalTiles).fill(0);
      collectedGames.forEach(g => {
        if (g.prediction) g.prediction.forEach((p, idx) => { freq[idx]++; if (p==='✅') weights[idx]++; });
      });
      return weights.map((w, i) => (w / freq[i]) || Math.random());
    }
  }
];
