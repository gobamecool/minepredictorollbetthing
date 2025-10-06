# Mines Predictor — Data-Driven & Enhanced

A lightweight client-side script that overlays predictions on Rollbet Mines grids.  
Designed for experimentation and research — it **collects anonymous game data locally** and uses simple algorithms (including data‑driven heuristics once enough games are collected) to highlight tiles that are likely safe or mined.

**Important:** Use responsibly. This tool manipulates only your browser and stores data locally. Do not use it to violate site terms of service or for illicit activity. The author is not responsible for misuse.

---

## Features

- Draggable / minimizable control panel
- Multiple algorithm choices (Random, MCTS, Minimax, Expectimax, PUCT, Frequency-based, Weighted, Hybrid)
- Data-driven algorithms enable after **50+** collected games
- Intercepts `/mines/*` fetch calls to log local game events
- Import/export collected data (JSON / TXT)
- Shows hashed server seed in pending predictions
- Toggle overlay on/off; respects already revealed/selected tiles
- No external dependencies — plain JavaScript (runs from console / userscript)

---

## Quick Start

### 1) Inject the script
- Open the site with the Mines game.
- Open Developer Tools → Console.
- Paste the script and press Enter.
- A floating "Mines Predictor" panel should appear.

Optionally you can turn the script into a bookmarklet or userscript (Tampermonkey/Greasemonkey).

### 2) Basic usage
1. Fill `Client Seed`, `Server Seed`, and `Nonce` (or let the fairness tab auto-fill them).
2. Choose grid size, number of mines, simulations, and an algorithm.
3. Click **Predict** to generate overlays (`✅` safe, `💣` mine, `❓` unknown).
4. Use **Toggle** to show/hide overlays.
5. After playing, the script will attempt to record game outcomes when it detects `/mines/start`, `/mines/reveal`, and `/mines/cashout` requests.

---

## UI Controls

- **Algorithm** — choose prediction strategy. Data-driven options are disabled until you collect at least 50 games.
- **Client Seed / Server Seed / Nonce** — used for deterministic algorithms and logging.
- **Mines / Grid Size** — match the site settings.
- **Simulations** — how many random trials certain algorithms run (higher = slower but more stable).
- **Predict** — produce overlay predictions.
- **Toggle** — show/hide overlays.
- **Export JSON / Export TXT / Import Data** — persist or load collected games.

---

## Data & Storage

- Collected game entries are stored in `localStorage` under the key `mines_predictor_data`.
- Export creates a JSON/TXT file; import will replace in-memory collected data after validation.
- Data-driven algorithms consume locally collected games only — nothing is uploaded.
- The script logs the hashed server seed (SHA-256) locally for transparency.

---

## Algorithms (short)

- **Random** — uniform random scores for unrevealed tiles.
- **MCTS** — simple Monte Carlo sampling.
- **Minimax / Expectimax** — toy heuristics.
- **PUCT / Frequency / Weighted / Hybrid** — data-driven algorithms using historical local data once ≥50 games are collected.

---

## Troubleshooting

- **No panel shows**: ensure you pasted the script after page DOM has loaded. Try reloading page then run again.
- **Tiles not detected**: the script uses site-specific CSS selectors; if the site changed class names you may need to update the `querySelectorAll` tile selectors in the script.
- **Data-driven algos disabled**: collect 50+ games (play and let the script observe `/mines/*` network calls).
- **Console errors about duplicate declarations**: ensure you only injected the script once — reload the page before re-injecting to avoid `Identifier ... already declared`.
- **Fairness tab auto-fill not working**: verify the site’s fairness panel selector or open the fairness tab manually and copy seeds.

---

## Development / Customization

- The algorithm list is defined at the top of the script — you can add or tweak functions there. Attach global variables if needed (`window.algorithmList`).
- To change tile detection selectors, edit the `detectGridTiles()` and `setupGridObserver()` queries.
- To change storage key: update `saveData()` / `loadData()` localStorage key.

---

