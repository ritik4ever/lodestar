import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE = path.join(__dirname, "agent-state.json");

function readState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn("Ignoring corrupt state file:", err.message);
    return {};
  }
}

function writeState(state) {
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(state, null, 2),
    "utf8"
  );
}

export function getAgentState(agentAddress) {
  const state = readState();

  if (!state[agentAddress]) {
    state[agentAddress] = {
      scoreHistory: [],
      providerHistory: {},
      cumulativeSpend: 0,
    };

    writeState(state);
  }

  return state[agentAddress];
}

export function saveAgentState(agentAddress, agentState) {
  const state = readState();
  state[agentAddress] = agentState;
  writeState(state);
}
