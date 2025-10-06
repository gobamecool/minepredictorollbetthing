// Rollbet Mines Predictor Extension - Data-Driven & Enhanced
// =========================================================
// Features:
// - Draggable, minimizable menu
// - Configurable simulation count
// - Handles already selected tiles (no overlays, always safe in sim)
// - Improved algorithms (more simulations, skips revealed)
// - Data collection: logs /mines/start and /mines/cashout API calls
// - Data-driven algorithms only enabled after 50+ games collected
// - Tracks prediction success/failure and ranks algorithms
// - Import/export data as JSON or TXT
// - Logs client seed and hashed server seed
// - Allows manual or random algorithm selection

// --- Data Collection State ---
let collectedGames = [];
let pendingPrediction = null; // { prediction, meta }
let bestAlgorithm = null;
let rankedAlgorithms = []; // For ranking data-driven algos
let currentPrediction = [];
let isOverlayOn = false;

// --- Grid Observer State (global) ---
let gridObserver = null; // single global observer for the grid

// --- Utility: Save Data to localStorage ---
function saveData() {
    localStorage.setItem('mines_predictor_data', JSON.stringify(collectedGames));
}
function loadData() {
    const raw = localStorage.getItem('mines_predictor_data');
    if (raw) {
        try { collectedGames = JSON.parse(raw); } catch { collectedGames = []; }
    }
}
loadData();

(() => {
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

    // If you need to access it globally inside the script, you can attach it:
    window.algorithmList = algorithmList;
})();

// --- SHA-256 Hash Utility ---
async function sha256(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// --- UI: Draggable, minimizable menu ---
const menu = document.createElement('div');
menu.style.cssText = `
  position: fixed; top: 10px; right: 10px; width: 270px; background: linear-gradient(135deg, #232a34, #0f5c9c); 
  padding: 0; border-radius: 10px; box-shadow: 0 0 10px rgba(0,0,0,0.5); z-index: 10000; color: #fff; font-family: Arial;
  user-select: none;
`;
menu.innerHTML = `
  <div id="menuHeader" style="cursor: move; padding: 10px; background: rgba(0,0,0,0.2); border-top-left-radius:10px; border-top-right-radius:10px; display:flex; align-items:center; justify-content:space-between;">
    <span style="font-weight:bold; text-shadow:1px 1px #000;">Mines Predictor</span>
    <button id="minimizeBtn" style="background:none; border:none; color:#fff; font-size:18px; cursor:pointer;">&#8211;</button>
  </div>
  <div id="menuBody" style="padding: 15px;">
    <div style="margin-bottom: 10px;">
      <label>Algorithm: 
        <select id="algorithmSelect" style="width: 100%; padding: 5px; border: none; border-radius: 5px;">
          <option value="random">Random (Best Ranked)</option>
          <option value="mcts">MCTS</option>
          <option value="minimax">MZZinimax</option>
          <option value="uct">UCT</option>
          <option value="puct">PUCT</option>
          <option value="expectimax">Expectimax</option>
          <option value="frequencySafe" disabled>Frequency Safe (requires 50+ games)</option>
          <option value="weightedSuccess" disabled>Weighted Success (requires 50+ games)</option>
          <option value="positionPattern" disabled>Position Pattern (requires 50+ games)</option>
          <option value="hybridDataDriven" disabled>Hybrid Data-Driven (requires 50+ games)</option>
        </select>
      </label>
    </div>
    <div style="margin-bottom: 10px;">
      <label>Client Seed: <input id="clientSeed" type="text" value="" style="width: 100%; padding: 5px; border: none; border-radius: 5px;"></label>
    </div>
    <div style="margin-bottom: 10px;">
      <label>Server Seed: <input id="serverSeed" type="text" value="" style="width: 100%; padding: 5px; border: none; border-radius: 5px;"></label>
    </div>
    <div style="margin-bottom: 10px;">
      <label>Nonce: <input id="nonce" type="number" value="" min="0" max="49" style="width: 100%; padding: 5px; border: none; border-radius: 5px;"></label>
    </div>
    <div style="margin-bottom: 10px;">
      <label>Mines: <input id="numMines" type="number" value="3" min="1" style="width: 100%; padding: 5px; border: none; border-radius: 5px;"></label>
    </div>
    <div style="margin-bottom: 10px;">
      <label>Grid Size: <select id="gridSize" style="width: 100%; padding: 5px; border: none; border-radius: 5px;">
         <option value="5" selected>5x5 (25 tiles)</option>
         <option value="6">6x6 (36 tiles)</option>
         <option value="7">7x7 (49 tiles)</option>
         <option value="8">8x8 (64 tiles)</option>
       </select></label>
    </div>
    <div style="margin-bottom: 10px;">
      <label>Simulations: <input id="simulations" type="number" value="2000" min="100" max="20000" step="100" style="width: 100%; padding: 5px; border: none; border-radius: 5px;"></label>
    </div>
    <button id="predictBtn" style="width: 100%; padding: 8px; background: linear-gradient(90deg, #00ffcc, #005c99); border: none; border-radius: 5px; color: #fff; cursor: pointer;">Predict</button>
    <button id="toggleBtn" style="width: 100%; padding: 8px; margin-top: 5px; background: linear-gradient(90deg, #005c99, #232a34); border: none; border-radius: 5px; color: #fff; cursor:pointer;">Toggle Off</button>
    <div id="dataStatus" style="margin-top:10px; font-size:13px; color:#00ffcc;"></div>
    <button id="exportJsonBtn" style="width:48%;margin-top:8px;margin-right:2%;background:#005c99;color:#fff;border:none;border-radius:5px;padding:6px;cursor:pointer;">Export JSON</button>
    <button id="exportTxtBtn" style="width:48%;margin-top:8px;background:#232a34;color:#fff;border:none;border-radius:5px;padding:6px;cursor:pointer;">Export TXT</button>
    <button id="importBtn" style="width:100%;margin-top:8px;background:#00ffcc;color:#232a34;border:none;border-radius:5px;padding:6px;cursor:pointer;">Import Data</button>
    <input id="importFile" type="file" accept=".json,.txt" style="display:none;">
  </div>
`;
document.body.appendChild(menu);

// --- Draggable Menu Logic ---
let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;
const menuHeader = menu.querySelector('#menuHeader');
menuHeader.addEventListener('mousedown', function(e) {
  isDragging = true;
  dragOffsetX = e.clientX - menu.getBoundingClientRect().left;
  dragOffsetY = e.clientY - menu.getBoundingClientRect().top;
  document.body.style.userSelect = 'none';
});
document.addEventListener('mousemove', function(e) {
  if (!isDragging) return;
  menu.style.left = (e.clientX - dragOffsetX) + 'px';
  menu.style.top = (e.clientY - dragOffsetY) + 'px';
  menu.style.right = 'auto';
});
document.addEventListener('mouseup', function() {
  isDragging = false;
  document.body.style.userSelect = '';
});

// --- Minimize Menu Logic ---
const minimizeBtn = menu.querySelector('#minimizeBtn');
const menuBody = menu.querySelector('#menuBody');
let isMinimized = false;
minimizeBtn.addEventListener('click', () => {
  isMinimized = !isMinimized;
  menuBody.style.display = isMinimized ? 'none' : 'block';
  minimizeBtn.innerHTML = isMinimized ? '&#x25A1;' : '&#8211;';
});

// --- Grid Detection & Observer ---
async function detectGridTiles(gridSize = 5) {
    async function attemptDetection() {
        return new Promise(resolve => {
            const tiles = document.querySelectorAll('._3d50fdef._13595ff3');
            const visibleTiles = Array.from(tiles).filter(tile => {
                const style = window.getComputedStyle(tile);
                return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            });
            if (visibleTiles.length > 0) {
                visibleTiles.forEach(tile => tile.style.display = 'inline-block');
                resolve(visibleTiles);
            } else setTimeout(() => resolve(attemptDetection()), 3000);
        });
    }


    let initialTiles = await attemptDetection();
    if (!initialTiles || initialTiles.length === 0) setupGridObserver();
    if (initialTiles.length !== gridSize * gridSize) initialTiles = Array.from({ length: gridSize * gridSize });
    window.tiles = initialTiles;
    updateUIDetection(initialTiles.length);
    return initialTiles;
}

// Add gridSize change listener
document.getElementById('gridSize').addEventListener('change', async (e) => {
    const newGridSize = parseInt(e.target.value);
    const tiles = await detectGridTiles(newGridSize);
    window.tiles = tiles;
    updateUIDetection(tiles.length);
});

// Initialize tiles
(async () => {
    await detectGridTiles(parseInt(document.getElementById('gridSize').value) || 5);
})();

// --- Observer for game state changes (single instance) ---
function setupGridObserver() {
    const gridContainer = document.querySelector('div._877da864'); // Parent container
    if (!gridContainer) {
        console.warn('Grid container not found. Retrying observation in 5 seconds.');
        setTimeout(setupGridObserver, 5000);
        return;
    }
    const observer = new MutationObserver(async () => {
        console.log('Grid container changed, re-detecting tiles...');
        const tiles = await detectGridTiles(parseInt(document.getElementById('gridSize').value) || 5);
        if (tiles.length > 0) {
            window.tiles = tiles; // Update global tiles
            updateUIDetection(tiles.length); // Notify UI
        }
    });
    observer.observe(gridContainer, { childList: true, subtree: true });
    console.log('Started observing grid container.');
}

// --- UI update function to reflect detection ---
function updateUIDetection(tileCount) {
    const promptElement = document.getElementById('dataStatus') || document.createElement('div'); 
    if (!document.getElementById('dataStatus')) {
        promptElement.id = 'dataStatus';
        promptElement.style.cssText = 'margin-top: 10px; font-size: 13px; color: #00ffcc;';
        menu.querySelector('#menuBody').appendChild(promptElement); 
    }
    promptElement.textContent = `Collected games: ${collectedGames.length} | Tiles Detected: ${tileCount}`;
    console.log(`UI updated: Tiles Detected: ${tileCount}`);
}

// --- Initialize tiles with async handling ---
(async () => {
    let tiles = await detectGridTiles();
    if (tiles.length === 0) {
        console.warn('Initial and observed detection failed. Using fallback grid size.');
        const gridSize = parseInt(document.getElementById('gridSize').value) || 5;
        tiles = Array.from({ length: gridSize * gridSize });
        console.log(`Falling back to ${gridSize}x${gridSize} (${tiles.length} tiles).`);
    }
    window.tiles = tiles; 
    updateUIDetection(tiles.length); 
})();

// --- Prediction clearing and padding utilities ---
function clearPrediction() {
    const tiles = document.querySelectorAll('._13595ff3');
    tiles.forEach(tile => {
        const overlay = tile.querySelector('.prediction-overlay');
        if (overlay) overlay.remove();
        tile.style.pointerEvents = 'auto';
    });
    isOverlayOn = false;
    document.getElementById('toggleBtn').textContent = 'Toggle On';
}

function padScores(scores, totalTiles) {
    const arr = new Array(totalTiles).fill(0);
    for (let i = 0; i < scores.length && i < totalTiles; i++) arr[i] = isNaN(scores[i]) ? 0 : scores[i];
    return arr;
}

// --- Algorithm ranking ---
function rankAlgorithms() {
    if (collectedGames.length < 50) {
        rankedAlgorithms = [];
        return;
    }
    const stats = {};
    algorithmList.forEach(a => stats[a.name] = { success: 0, total: 0 });
    collectedGames.forEach(g => {
        if (g.prediction && g.prediction.algorithm) {
            stats[g.prediction.algorithm].total++;
            if (g.success) stats[g.prediction.algorithm].success++;
        }
    });
    rankedAlgorithms = Object.entries(stats)
        .map(([name, stat]) => ({ name, rate: stat.total ? stat.success / stat.total : 0 }))
        .sort((a, b) => b.rate - a.rate);
}

// --- Predict button handler ---
document.getElementById('predictBtn').addEventListener('click', async () => {
    rankAlgorithms();
    const algoSelect = document.getElementById('algorithmSelect');
    let selectedAlgo = algoSelect.value;

    ["frequencySafe", "weightedSuccess", "positionPattern", "hybridDataDriven"].forEach(name => {
        document.querySelector(`#algorithmSelect option[value="${name}"]`).disabled = collectedGames.length < 50;
    });

    let algoObj;
    if (selectedAlgo === "random") {
        if (rankedAlgorithms.length > 0 && rankedAlgorithms[0].rate > 0) {
            algoObj = algorithmList.find(a => a.name === rankedAlgorithms[0].name);
        } else {
            const available = algorithmList.filter(a => !a.dataDriven || collectedGames.length >= 50);
            algoObj = available[Math.floor(Math.random() * available.length)];
        }
    } else {
        algoObj = algorithmList.find(a => a.name === selectedAlgo) || algorithmList[0];
        if (algoObj.dataDriven && collectedGames.length < 50) {
            alert('This data-driven algorithm is disabled until 50+ games are collected for training.');
            return;
        }
    }

    const clientSeed = document.getElementById('clientSeed').value;
    const serverSeed = document.getElementById('serverSeed').value;
    let nonceInput = document.getElementById('nonce');
    let nonce = parseInt(nonceInput.value) || 0; 
    nonceInput.value = (nonce + 1).toString(); 
    const numMines = parseInt(document.getElementById('numMines').value);
    const gridSize = parseInt(document.getElementById('gridSize').value);
    const totalTiles = gridSize * gridSize;
    const maxMines = totalTiles - 1;
    const simulations = parseInt(document.getElementById('simulations').value);

    let allTiles = window.tiles || Array.from({ length: totalTiles });
    if (allTiles.length !== totalTiles) {
        console.warn(`Tile count (${allTiles.length}) doesn’t match ${totalTiles}. Using fallback array.`);
        allTiles = Array.from({ length: totalTiles });
    }

    const revealedIndices = [];
    allTiles.forEach((tile, idx) => {
        if (tile.classList && (tile.classList.contains('selected') || tile.classList.contains('revealed'))) revealedIndices.push(idx);
    });

    if (numMines < 1 || numMines > maxMines || !clientSeed || !serverSeed) {
        alert(`Invalid input. Ensure Client Seed, Server Seed, and Mines (1-${maxMines}) are set.`);
        return;
    }

    const seedStr = `${clientSeed}:${serverSeed}:${nonce}`;
    const scores = padScores(algoObj.fn(seedStr, numMines, totalTiles, revealedIndices, simulations), totalTiles);

    const scorePairs = scores.map((score, idx) => ({ score, idx }));
    const sortedSafe = [...scorePairs].sort((a, b) => b.score - a.score);
    const sortedBomb = [...scorePairs].sort((a, b) => a.score - b.score);

    const safeFactor = Math.min(0.7, 1 - (numMines / totalTiles));
    const numSafe = Math.max(5, Math.floor(totalTiles * safeFactor));
    const bombScores = sortedBomb.map(p => p.score);
    const meanScore = bombScores.reduce((a, b) => a + b, 0) / bombScores.length || 0;
    const stdDev = Math.sqrt(bombScores.reduce((a, b) => a + Math.pow(b - meanScore, 2), 0) / bombScores.length) || 0.1;
    const confidenceThreshold = meanScore + stdDev;
    const confidentBombs = bombScores.filter(s => s < confidenceThreshold).length;
    const maxExtraBombs = Math.min(2, Math.floor(numMines * 0.2));
    const numBomb = numMines + (confidentBombs > numMines ? Math.min(maxExtraBombs, confidentBombs - numMines) : 0);

    const prediction = new Array(totalTiles).fill('❓');
    for (let i = 0; i < numSafe && i < sortedSafe.length; i++) prediction[sortedSafe[i].idx] = '✅';
    for (let i = 0; i < numBomb && i < sortedBomb.length; i++) prediction[sortedBomb[i].idx] = '💣';

    currentPrediction = prediction;

    while (currentPrediction.length < allTiles.length) {
        currentPrediction.push('❓');
    }

    allTiles.forEach((tile, index) => {
        if (tile.classList && (tile.classList.contains('selected') || tile.classList.contains('revealed'))) return;
        let overlay = tile.querySelector('.prediction-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'prediction-overlay';
            overlay.style.cssText = `
                position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
                display: flex; align-items: center; justify-content: center; 
                font-size: 24px; pointer-events: none; z-index: 10001;
            `;
            if (tile.nodeType === 1) {
                tile.style.position = 'relative';
                tile.appendChild(overlay);
            }
        }
        overlay.textContent = currentPrediction[index];
    });
    isOverlayOn = true;
    document.getElementById('toggleBtn').textContent = 'Toggle Off';
    setupGridObserver();

    const serverSeedHash = await sha256(serverSeed);
    pendingPrediction = {
        prediction: {
            algorithm: algoObj.name,
            prediction: currentPrediction.slice(),
            revealedIndices: revealedIndices.slice(),
            gridSize,
            numMines,
            clientSeed,
            serverSeed,
            serverSeedHash,
            nonce,
            time: Date.now()
        }
    };
});

// --- Toggle button handler ---
document.getElementById('toggleBtn').addEventListener('click', () => {
    const grid = document.querySelector('div._3d50fdef');
    if (!grid) return;
    const allTiles = Array.from(grid.querySelectorAll('._13595ff3'));
    if (isOverlayOn) {
        clearPrediction();
    } else if (currentPrediction.length > 0) {
        while (currentPrediction.length < allTiles.length) {
            currentPrediction.push('❓');
        }
        allTiles.forEach((tile, index) => {
            if (tile.classList.contains('selected') || tile.classList.contains('revealed')) return;
            let overlay = tile.querySelector('.prediction-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'prediction-overlay';
                overlay.style.cssText = `
                    position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
                    display: flex; align-items: center; justify-content: center; 
                    font-size: 24px; pointer-events: none; z-index: 10001;
                `;
                tile.style.position = 'relative';
                tile.appendChild(overlay);
            }
            overlay.textContent = currentPrediction[index];
        });
        isOverlayOn = true;
        document.getElementById('toggleBtn').textContent = 'Toggle Off';
        setupGridObserver();
    }
});

// --- Data Collection: Intercept /mines API calls ---
(function interceptFetch() {
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
        const url = args[0];
        const method = args[1]?.method || 'GET';
        console.log('Fetch API Call:', { url, method, timestamp: new Date().toISOString() });

        if (typeof url === 'string' && url.includes('/mines/')) {
            const response = await origFetch.apply(this, args);
            const clone = response.clone();
            clone.json().then(data => {
                const logDetails = {
                    url,
                    method,
                    status: response.status,
                    timestamp: new Date().toISOString(),
                    request: args[1]?.body ? JSON.parse(args[1].body) : null,
                    response: data
                };

                let gameData = {};
                let nonceInput = document.getElementById('nonce');
                let nonce = parseInt(nonceInput.value) || 0;

                if (url.includes('/mines/start')) {
                    gameData = {
                        type: 'start',
                        activeGameId: data.activeGameId,
                        nextTileMultiplier: data.nextTileMultiplier,
                        nextTilePayout: data.nextTilePayout,
                        clientSeed: document.getElementById('clientSeed')?.value || 'N/A',
                        serverSeed: document.getElementById('serverSeed')?.value || 'N/A',
                        nonce,
                        gridSize: parseInt(document.getElementById('gridSize')?.value) || 5,
                        numMines: parseInt(document.getElementById('numMines')?.value) || 3
                    };
                    if (gameData.clientSeed !== 'N/A') {
                        sha256(gameData.clientSeed).then(hashed => {
                            gameData.hashedClientSeed = hashed;
                            console.log('Game Start Details:', { ...logDetails, ...gameData });
                        });
                    }
                    gameData.clientToken = localStorage.getItem('authToken') || 'N/A';
                } else if (url.includes('/mines/reveal')) {
                    gameData = {
                        type: 'reveal',
                        isMine: data.isMine,
                        revealedTiles: data.revealedTiles,
                        minePositions: data.minePositions,
                        nextTileMultiplier: data.nextTileMultiplier,
                        nextTilePayout: data.nextTilePayout,
                        nonce
                    };
                } else if (url.includes('/mines/cashout')) {
                    gameData = {
                        type: 'cashout',
                        payout: data.payout,
                        finalMultiplier: data.finalMultiplier,
                        nonce
                    };
                }

                console.log('Game Data:', { ...logDetails, ...gameData });

                if (pendingPrediction) {
                    const success = (url.includes('/mines/cashout') && data.success) ||
                                   (url.includes('/mines/reveal') && !data.isMine) ||
                                   false;
                    const gameEntry = {
                        ...pendingPrediction,
                        type: gameData.type,
                        success: success,
                        gameData: { ...gameData, response: data }
                    };
                    collectedGames.push(gameEntry);
                    saveData();
                    pendingPrediction = null;
                    updateDataStatus();
                } else if (url.includes('/mines/start')) {
                    collectedGames.push({
                        type: 'start',
                        time: Date.now(),
                        success: false,
                        gameData: { ...gameData, response: data }
                    });
                    saveData();
                    updateDataStatus();
                }
            }).catch(err => {
                console.error('Failed to parse response:', { url, error: err, timestamp: new Date().toISOString() });
            });
            return response;
        }
        return origFetch.apply(this, args);
    };
})();

// --- Update Data Status / Ranked Algorithms ---
function updateDataStatus() {
    rankAlgorithms();
    const el = document.getElementById('dataStatus');
    if (!el) return;
    let rankText = '';
    if (rankedAlgorithms.length > 0) {
        rankText = ' | Ranked: ' + rankedAlgorithms.map(r => `${r.name} (${(r.rate*100).toFixed(1)}%)`).join(', ');
    }
    el.textContent = `Collected games: ${collectedGames.length}${rankText}`;
    ["frequencySafe", "weightedSuccess", "positionPattern", "hybridDataDriven"].forEach(name => {
        const opt = document.querySelector(`#algorithmSelect option[value="${name}"]`);
        if (opt) opt.disabled = collectedGames.length < 50;
    });
}
updateDataStatus();

// --- Import/Export Functionality ---
document.getElementById('exportJsonBtn').addEventListener('click', () => {
    const dataStr = JSON.stringify(collectedGames, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mines_predictor_games.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
});

document.getElementById('exportTxtBtn').addEventListener('click', () => {
    const dataStr = JSON.stringify(collectedGames, null, 2);
    const blob = new Blob([dataStr], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mines_predictor_games.txt';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
});

document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const imported = JSON.parse(evt.target.result);
            if (Array.isArray(imported)) {
                collectedGames = imported;
                saveData();
                updateDataStatus();
                alert('Data imported successfully!');
            } else {
                alert('Invalid data format.');
            }
        } catch {
            alert('Failed to parse file. Make sure it is valid JSON.');
        }
    };
    reader.readAsText(file);
});

// --- Fairness tab detection ---
let fairnessObserver = null;
function setupFairnessObserver() {
    const fairnessTab = document.querySelector('div._107aa5a2');
    if (fairnessTab) {
        fairnessObserver = new MutationObserver(() => {
            extractFairnessData();
        });
        fairnessObserver.observe(fairnessTab, { attributes: true, attributeFilter: ['style'] });
    }
}

window.addEventListener('load', () => {
    setTimeout(() => {
        extractFairnessData();
        setupFairnessObserver();
    }, 1000);
});

function extractFairnessData() {
    const fairnessTab = document.querySelector('div._107aa5a2');
    if (!fairnessTab || fairnessTab.style.display === 'none') return;
    const spans = fairnessTab.querySelectorAll('span');
    let clientSeed = '', serverSeed = '', nonce = '';
    spans.forEach(span => {
        const text = span.textContent.trim();
        if (text.toLowerCase().includes('client seed')) clientSeed = text.split(':')[1]?.trim() || '';
        if (text.toLowerCase().includes('server seed')) serverSeed = text.split(':')[1]?.trim() || '';
        if (text.toLowerCase().includes('nonce')) nonce = text.split(':')[1]?.trim() || '';
    });
    if (clientSeed) document.getElementById('clientSeed').value = clientSeed;
    if (serverSeed) document.getElementById('serverSeed').value = serverSeed;
    if (nonce) document.getElementById('nonce').value = nonce;
}