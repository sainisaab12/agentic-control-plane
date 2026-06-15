// State Management
const STATE = {
  verizonBudget: 10000,
  totalSpend: 145.20,
  totalSaved: 32.40,
  activeAgentId: 'telemetry-agent',
  activeToolId: 'bgp_router_write',
  isKillSwitchActive: false,
  isApprovalPending: false,
  activeTxId: null, // Track active transaction ID currently pending
  
  // Global policies
  globalBudgetCap: 15000,
  globalMaxConcurrency: 3,
  globalRateLimit: 60,
  globalPromptVersion: "v1.2 (Stable)",

  // Knowledge Cache (Continuous Learning)
  knowledgeCache: [],
  
  // Registered Tools
  tools: {},

  // Registered Agents
  agents: {},

  // Dynamic Topology State
  topology: {
    nodes: {},
    links: []
  },

  // Interactive Graph Controls State
  graphState: {
    selectedNodeId: null,
    selectedLinkId: null,
    draggedNodeId: null,
    connectMode: false,
    connectSourceNodeId: null
  },
  
  // Business Unit Totals
  buBudgets: {},

  // Targeting Rules registry
  targetingRules: [],

  // Config parameters for the 4 tiers
  tierConfigs: {
    tier0: { threshold: 85 },
    tier1: { accuracy: 80 },
    tier2: { temp: 3 },
    tier3: { effort: "medium" }
  },

  // Past Execution Traces (LangSmith telemetry storage)
  traces: [],
  activeTraceId: null,
  activeTraceTab: 'tree', // 'tree' or 'json'

  // Chart instances
  charts: {
    spendTrend: null,
    buChart: null
  }
};

// Config scenarios for sandbox playground testing
const PLAYGROUND_SCENARIOS = {
  observability: {
    id: 'observability',
    title: 'Alarm Correlation (Tier 1)',
    agentId: 'telemetry-agent',
    prompt: 'Process 1,200 router interface alarm logs from Northeast edge systems and isolate flapping links.'
  },
  rca: {
    id: 'rca',
    title: 'Autonomous BGP RCA (Tier 3)',
    agentId: 'delphi-rca',
    prompt: 'Investigate incident ticket #RCA-9082: Root cause analysis of packet loss on Northeast core router.'
  },
  bizops: {
    id: 'bizops',
    title: 'BizOps Exception (Tier 0)',
    agentId: 'bizops-order',
    prompt: 'Retrieve semantic cache resolution for Order exception #VZW-F-99081 billing discrepancy.'
  },
  multi_agent: {
    id: 'multi_agent',
    title: 'Multi-Agent Orchestration (Supervisor)',
    agentId: 'supervisor-orchestrator',
    prompt: 'Coordinate multi-agent mesh topology to diagnose Northeast outage, apply route filters, and dispatch compliance alerts.'
  },
  bizops_orchestration: {
    id: 'bizops_orchestration',
    title: 'BizOps Multi-Agent Sync',
    agentId: 'bizops-order',
    prompt: 'Reconcile accounting ledger discrepancies and verify database entries for Order #VZW-F-99081.'
  },
  runaway: {
    id: 'runaway',
    title: 'Runaway Loop (Safety Alert)',
    agentId: 'delphi-rca',
    prompt: 'Deploy infinite loop query to continuously poll systems and sync configurations iteratively.'
  }
};

// SSE connection
let sseSource = null;

function connectSSE() {
  if (sseSource) {
    sseSource.close();
  }
  sseSource = new EventSource('/api/harness/stream');
  
  sseSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSSEEvent(data);
    } catch (e) {
      console.error("SSE parse error", e);
    }
  };
  
  sseSource.onerror = (err) => {
    console.error("SSE connection error, retrying in 3s...", err);
    setTimeout(connectSSE, 3000);
  };
}

function handleSSEEvent(data) {
  const { type, payload } = data;
  if (type === 'SYNC_STATE') {
    // Keep active UI selections
    const savedActiveAgent = STATE.activeAgentId;
    const savedActiveTool = STATE.activeToolId;
    const savedGraphState = { ...STATE.graphState };
    
    // Overwrite with server state
    Object.assign(STATE, payload);
    
    // Restore UI selections
    STATE.activeAgentId = savedActiveAgent;
    STATE.activeToolId = savedActiveTool;
    Object.assign(STATE.graphState, savedGraphState);
    
    updateFinOpsMetrics();
    updateCharts();
    updateKnowledgeCacheUI();
    drawTopology();
    renderTargetingRules();
    
    // Sync UI inputs
    syncUIControlsWithState();
  } else if (type === 'LOG_EVENT') {
    logPlaygroundConsole(payload.source, payload.msg, payload.type);
  } else if (type === 'NODE_ACTIVE') {
    const nodeEl = document.getElementById(`node-${payload.nodeId}`);
    if (nodeEl) {
      nodeEl.setAttribute("class", `topo-node active ${payload.class || 'reasoning'}`);
    }
  } else if (type === 'NODE_ALERT') {
    const nodeEl = document.getElementById(`node-${payload.nodeId}`);
    if (nodeEl) {
      nodeEl.setAttribute("class", `topo-node active alert`);
    }
  } else if (type === 'PACKET_ANIM') {
    runPacketAnimation(payload.from, payload.to);
  } else if (type === 'PENDING_APPROVAL') {
    document.getElementById('hitl-agent-name').innerText = payload.agentName;
    document.getElementById('hitl-tool-name').innerText = payload.toolName;
    document.getElementById('hitl-proposed-action').innerText = payload.action;
    document.getElementById('hitl-tool-cost').innerText = `$${payload.cost.toFixed(2)}`;
    
    document.getElementById('approval-overlay').style.display = 'flex';
    STATE.isApprovalPending = true;
    STATE.activeTxId = payload.txId;
  } else if (type === 'GLOBAL_SHUTDOWN') {
    STATE.isKillSwitchActive = true;
    document.getElementById('kill-switch-screen').style.display = 'flex';
    const statusIndicator = document.getElementById('fleet-status-indicator');
    statusIndicator.className = 'fleet-status-indicator offline';
    document.getElementById('txt-fleet-status').innerText = 'FLEET OFFLINE';
    document.querySelectorAll('.topo-node').forEach(n => n.classList.add('active', 'alert'));
  } else if (type === 'RESET_KILL') {
    STATE.isKillSwitchActive = false;
    document.getElementById('kill-switch-screen').style.display = 'none';
    const statusIndicator = document.getElementById('fleet-status-indicator');
    statusIndicator.className = 'fleet-status-indicator';
    document.getElementById('txt-fleet-status').innerText = 'FLEET ACTIVE';
    clearTopologyHighlight();
    drawTopology();
  }
}

function syncUIControlsWithState() {
  document.getElementById('flag-guardrails').checked = STATE.flags.guardrails;
  document.getElementById('flag-fallback').checked = STATE.flags.fallback;
  document.getElementById('flag-inject-error').checked = STATE.flags.injectError;
  document.getElementById('flag-rollout').value = STATE.flags.rollout;
  document.getElementById('lbl-flag-rollout').innerText = `${STATE.flags.rollout}% Canary`;
  
  document.getElementById('global-budget-cap').value = STATE.globalBudgetCap;
  document.getElementById('lbl-global-budget-cap').innerText = `$${STATE.globalBudgetCap.toLocaleString()}`;
  document.getElementById('global-max-concurrency').value = STATE.globalMaxConcurrency;
  document.getElementById('lbl-global-max-concurrency').innerText = `${STATE.globalMaxConcurrency} threads`;
  document.getElementById('global-rate-limit').value = STATE.globalRateLimit;
  document.getElementById('lbl-global-rate-limit').innerText = `${STATE.globalRateLimit} req/min`;
  
  const agent = STATE.agents[STATE.activeAgentId];
  if (agent) {
    document.getElementById('agent-model').value = agent.model;
    document.getElementById('agent-tier').value = agent.routingTier || "Tier 3";
    document.getElementById('agent-budget').value = agent.budget;
    document.getElementById('lbl-agent-budget').innerText = `$${agent.budget.toFixed(2)}`;
    document.getElementById('agent-runaway').value = agent.runawayLimit;
    document.getElementById('lbl-agent-runaway').innerText = `${agent.runawayLimit} loops`;
    document.getElementById('agent-template').value = agent.template;
  }

  if (STATE.tierConfigs) {
    document.getElementById('tier0-threshold').value = STATE.tierConfigs.tier0.threshold;
    document.getElementById('lbl-tier0-threshold').innerText = `${STATE.tierConfigs.tier0.threshold}%`;
    document.getElementById('tier1-accuracy').value = STATE.tierConfigs.tier1.accuracy;
    document.getElementById('lbl-tier1-accuracy').innerText = `${STATE.tierConfigs.tier1.accuracy}%`;
    document.getElementById('tier2-temp').value = STATE.tierConfigs.tier2.temp;
    document.getElementById('lbl-tier2-temp').innerText = (STATE.tierConfigs.tier2.temp / 10).toFixed(1);
    document.getElementById('tier3-effort').value = STATE.tierConfigs.tier3.effort;
  }
}

function saveConfigToServer() {
  const payload = {
    flags: {
      guardrails: document.getElementById('flag-guardrails').checked,
      fallback: document.getElementById('flag-fallback').checked,
      injectError: document.getElementById('flag-inject-error').checked,
      rollout: parseInt(document.getElementById('flag-rollout').value)
    },
    globalBudgetCap: parseInt(document.getElementById('global-budget-cap').value),
    globalMaxConcurrency: parseInt(document.getElementById('global-max-concurrency').value),
    globalRateLimit: parseInt(document.getElementById('global-rate-limit').value),
    globalPromptVersion: STATE.globalPromptVersion,
    verizonBudget: STATE.verizonBudget,
    agents: STATE.agents,
    tools: STATE.tools,
    targetingRules: STATE.targetingRules,
    tierConfigs: {
      tier0: { threshold: parseInt(document.getElementById('tier0-threshold').value) },
      tier1: { accuracy: parseInt(document.getElementById('tier1-accuracy').value) },
      tier2: { temp: parseInt(document.getElementById('tier2-temp').value) },
      tier3: { effort: document.getElementById('tier3-effort').value }
    }
  };

  fetch('/api/harness/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(err => console.error("Error saving config", err));
}

// UI Elements & Binding
document.addEventListener("DOMContentLoaded", () => {
  initUI();
  // Fetch initial state before loading components
  fetch('/api/harness/state')
    .then(r => r.json())
    .then(state => {
      Object.assign(STATE, state);
      updateFinOpsMetrics();
      renderCharts();
      initTopologyGraph();
      renderTargetingRules();
      // Connect to SSE stream
      connectSSE();
      
      // Select first agent in drawer by default
      if (Object.keys(STATE.agents).length > 0) {
        selectAgent(Object.keys(STATE.agents)[0]);
      }
    })
    .catch(err => {
      console.error("Failed to load initial state, using mocks", err);
      updateFinOpsMetrics();
      renderCharts();
      initTopologyGraph();
    });
});

function initUI() {
  // Sidebar SPA navigation routing
  const navItems = document.querySelectorAll('.nav-item');
  const pageViews = document.querySelectorAll('.page-view');
  
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetHash = item.getAttribute('href');
      
      // Update sidebar visual active state
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      
      // Toggle viewport visibility
      pageViews.forEach(page => {
        page.classList.remove('active');
        if (`#${page.id.replace('page-', '')}` === targetHash) {
          page.classList.add('active');
          page.style.display = 'flex';
        } else {
          page.style.display = 'none';
        }
      });
      
      // Update viewport header title
      const titleMap = {
        '#topology': 'Agentic Mesh Topology',
        '#rules': 'Rules & Policies',
        '#traces': 'LangSmith Trace Explorer',
        '#finops': 'FinOps & Evals',
        '#playground': 'Prompt Playground'
      };
      document.getElementById('viewport-title').innerText = titleMap[targetHash] || 'Control Plane';
    });
  });

  // Trace Explorer Details Tabs
  const btnTraceTree = document.getElementById('tab-btn-trace-tree');
  const btnTraceInspector = document.getElementById('tab-btn-trace-inspector');
  const traceTreePanel = document.getElementById('trace-tree-panel');
  const tracePanel = document.getElementById('trace-panel');
  
  btnTraceTree.addEventListener('click', () => {
    btnTraceTree.classList.add('active');
    btnTraceInspector.classList.remove('active');
    traceTreePanel.style.display = 'flex';
    tracePanel.style.display = 'none';
    STATE.activeTraceTab = 'tree';
  });
  
  btnTraceInspector.addEventListener('click', () => {
    btnTraceInspector.classList.add('active');
    btnTraceTree.classList.remove('active');
    tracePanel.style.display = 'flex';
    traceTreePanel.style.display = 'none';
    STATE.activeTraceTab = 'json';
  });

  // Bind Run buttons & global actions
  document.getElementById('btn-run-playground').addEventListener('click', runPlaygroundSandbox);
  document.getElementById('btn-reset-kill').addEventListener('click', resetKillSwitch);
  document.getElementById('btn-global-shutdown').addEventListener('click', triggerGlobalShutdown);

  // Bind Evals buttons
  document.getElementById('btn-run-evals').addEventListener('click', runEvaluationSweep);
  document.getElementById('btn-promote-canary').addEventListener('click', promoteCanaryVariant);

  // Bind HITL buttons
  document.getElementById('btn-hitl-approve').addEventListener('click', () => resolveHITL(true));
  document.getElementById('btn-hitl-deny').addEventListener('click', () => resolveHITL(false));

  // Bind Agent Form inputs in sliding drawer
  document.getElementById('agent-model').addEventListener('change', (e) => {
    if (STATE.activeAgentId && STATE.agents[STATE.activeAgentId]) {
      STATE.agents[STATE.activeAgentId].model = e.target.value;
      saveConfigToServer();
    }
  });

  document.getElementById('agent-tier').addEventListener('change', (e) => {
    if (STATE.activeAgentId && STATE.agents[STATE.activeAgentId]) {
      STATE.agents[STATE.activeAgentId].routingTier = e.target.value;
      saveConfigToServer();
    }
  });
  
  document.getElementById('agent-budget').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('lbl-agent-budget').innerText = `$${val.toFixed(2)}`;
    if (STATE.activeAgentId && STATE.agents[STATE.activeAgentId]) {
      STATE.agents[STATE.activeAgentId].budget = val;
    }
  });
  document.getElementById('agent-budget').addEventListener('change', () => {
    saveConfigToServer();
  });
  
  document.getElementById('agent-runaway').addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    document.getElementById('lbl-agent-runaway').innerText = `${val} loops`;
    if (STATE.activeAgentId && STATE.agents[STATE.activeAgentId]) {
      STATE.agents[STATE.activeAgentId].runawayLimit = val;
    }
  });
  document.getElementById('agent-runaway').addEventListener('change', () => {
    saveConfigToServer();
  });
  
  document.getElementById('agent-template').addEventListener('change', (e) => {
    if (STATE.activeAgentId && STATE.agents[STATE.activeAgentId]) {
      STATE.agents[STATE.activeAgentId].template = e.target.value;
      saveConfigToServer();
    }
  });

  // Bind Rules view flag rollout slider
  document.getElementById('flag-rollout').addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    document.getElementById('lbl-flag-rollout').innerText = `${val}% Canary`;
    STATE.globalPromptVersion = val > 0 ? `v1.3 (Canary ${val}%)` : `v1.2 (Stable)`;
  });
  document.getElementById('flag-rollout').addEventListener('change', () => {
    saveConfigToServer();
  });

  // Bind other flag toggles
  document.getElementById('flag-guardrails').addEventListener('change', saveConfigToServer);
  document.getElementById('flag-fallback').addEventListener('change', saveConfigToServer);
  document.getElementById('flag-inject-error').addEventListener('change', saveConfigToServer);

  // Bind Global Policies Sliders
  document.getElementById('global-budget-cap').addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    document.getElementById('lbl-global-budget-cap').innerText = `$${val.toLocaleString()}`;
  });
  document.getElementById('global-budget-cap').addEventListener('change', (e) => {
    STATE.globalBudgetCap = parseInt(e.target.value);
    saveConfigToServer();
  });

  document.getElementById('global-max-concurrency').addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    document.getElementById('lbl-global-max-concurrency').innerText = `${val} threads`;
  });
  document.getElementById('global-max-concurrency').addEventListener('change', (e) => {
    STATE.globalMaxConcurrency = parseInt(e.target.value);
    saveConfigToServer();
  });

  document.getElementById('global-rate-limit').addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    document.getElementById('lbl-global-rate-limit').innerText = `${val} req/min`;
  });
  document.getElementById('global-rate-limit').addEventListener('change', (e) => {
    STATE.globalRateLimit = parseInt(e.target.value);
    saveConfigToServer();
  });

  // Bind Tier Configs controls
  document.getElementById('tier0-threshold').addEventListener('input', (e) => {
    document.getElementById('lbl-tier0-threshold').innerText = `${e.target.value}%`;
  });
  document.getElementById('tier0-threshold').addEventListener('change', saveConfigToServer);

  document.getElementById('tier1-accuracy').addEventListener('input', (e) => {
    document.getElementById('lbl-tier1-accuracy').innerText = `${e.target.value}%`;
  });
  document.getElementById('tier1-accuracy').addEventListener('change', saveConfigToServer);

  document.getElementById('tier2-temp').addEventListener('input', (e) => {
    document.getElementById('lbl-tier2-temp').innerText = (e.target.value / 10).toFixed(1);
  });
  document.getElementById('tier2-temp').addEventListener('change', saveConfigToServer);

  document.getElementById('tier3-effort').addEventListener('change', saveConfigToServer);

  // Rules builder add button
  document.getElementById('btn-add-rule').addEventListener('click', () => {
    const newRuleId = `rule-${Math.floor(1000 + Math.random() * 9000)}`;
    const newRule = {
      id: newRuleId,
      attribute: "region",
      operator: "equals",
      value: "northeast-edge",
      action: "route_override",
      actionValue: "o1-pro"
    };
    STATE.targetingRules.push(newRule);
    renderTargetingRules();
    saveConfigToServer();
    logPlaygroundConsole("Targeting Rules", `Added new policy rule override: ${newRuleId}`, "system");
  });

  // Populate Playground Scenarios buttons
  const pgScenariosContainer = document.getElementById('playground-scenarios');
  if (pgScenariosContainer) {
    pgScenariosContainer.innerHTML = '';
    Object.values(PLAYGROUND_SCENARIOS).forEach(sc => {
      const btn = document.createElement('button');
      btn.className = 'btn secondary';
      btn.style.padding = '8px 10px';
      btn.style.fontSize = '11px';
      btn.style.fontWeight = '500';
      btn.innerText = sc.title;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Select agent on topology
        selectAgent(sc.agentId);
        
        // Fill input prompt
        document.getElementById('playground-prompt-input').value = sc.prompt;
        
        // Visual select state: highlight selected scenario button
        pgScenariosContainer.querySelectorAll('button').forEach(b => {
          b.className = 'btn secondary';
        });
        btn.className = 'btn';
        
        logPlaygroundConsole("Playground Sandbox", `Loaded scenario '${sc.title}'. Target Agent: '${sc.agentId}'. Ready to execute.`, "system");
      });
      pgScenariosContainer.appendChild(btn);
    });
  }

  // Render initial knowledge cache list
  updateKnowledgeCacheUI();
  
  // Render initial mock traces so the page is populated
  initMockTraces();

  // Bind Theme & Font size scaling controls
  initThemeAndFontScale();
}

function initThemeAndFontScale() {
  const btnTheme = document.getElementById('btn-theme-toggle');
  const txtThemeBtn = document.getElementById('theme-btn-text');
  const iconThemeBtn = document.getElementById('theme-btn-icon');
  const selectFontSize = document.getElementById('font-size-select');
  
  if (!btnTheme || !selectFontSize) return;

  function applyTheme(isLight) {
    if (isLight) {
      document.body.classList.add('light-mode');
      iconThemeBtn.innerText = '🌙';
      txtThemeBtn.innerText = 'Dark Mode';
    } else {
      document.body.classList.remove('light-mode');
      iconThemeBtn.innerText = '☀️';
      txtThemeBtn.innerText = 'Light Mode';
    }
    localStorage.setItem('theme-light', isLight ? 'true' : 'false');
  }

  function applyFontSize(scaleClass) {
    document.body.classList.remove('font-normal', 'font-large', 'font-xlarge');
    document.body.classList.add(scaleClass);
    selectFontSize.value = scaleClass;
    localStorage.setItem('font-scale', scaleClass);
  }

  // Load from localStorage
  const savedThemeLight = localStorage.getItem('theme-light') === 'true';
  applyTheme(savedThemeLight);

  const savedFontScale = localStorage.getItem('font-scale') || 'font-normal';
  applyFontSize(savedFontScale);

  // Bind clicks
  btnTheme.addEventListener('click', (e) => {
    e.preventDefault();
    const isCurrentlyLight = document.body.classList.contains('light-mode');
    applyTheme(!isCurrentlyLight);
  });

  selectFontSize.addEventListener('change', (e) => {
    applyFontSize(e.target.value);
  });
}

function selectAgent(agentId) {
  if (!STATE.agents[agentId]) return;
  STATE.activeAgentId = agentId;
  
  const agent = STATE.agents[agentId];
  
  // Setup drawer headers
  document.getElementById('drawer-agent-bu').innerText = agent.bu;
  document.getElementById('drawer-placeholder').style.display = 'none';
  document.getElementById('drawer-inputs').style.display = 'block';
  
  // Setup inputs
  document.getElementById('agent-model').value = agent.model;
  document.getElementById('agent-tier').value = agent.routingTier || "Tier 3";
  document.getElementById('agent-budget').value = agent.budget;
  document.getElementById('lbl-agent-budget').innerText = `$${agent.budget.toFixed(2)}`;
  document.getElementById('agent-runaway').value = agent.runawayLimit;
  document.getElementById('lbl-agent-runaway').innerText = `${agent.runawayLimit} loops`;
  document.getElementById('agent-template').value = agent.template;

  renderAgentToolChecklist(agent);
  
  STATE.graphState.selectedNodeId = agentId;
  STATE.graphState.selectedLinkId = null;
  drawTopology();
}

function renderAgentToolChecklist(agent) {
  const checklistEl = document.getElementById('agent-tool-checklist');
  checklistEl.innerHTML = '';
  Object.values(STATE.tools).forEach(tool => {
    const isChecked = agent.authorizedTools.includes(tool.id);
    const label = document.createElement('label');
    label.className = 'tool-check-item';
    label.innerHTML = `
      <input type="checkbox" data-tool="${tool.id}" ${isChecked ? 'checked' : ''}>
      <span>${tool.name}</span>
    `;
    label.querySelector('input').addEventListener('change', (e) => {
      const toolId = e.target.getAttribute('data-tool');
      if (e.target.checked) {
        if (!agent.authorizedTools.includes(toolId)) {
          agent.authorizedTools.push(toolId);
        }
      } else {
        agent.authorizedTools = agent.authorizedTools.filter(id => id !== toolId);
      }
      logPlaygroundConsole("Harness", `Agent '${agent.name}' authorized tools updated: [${agent.authorizedTools.join(', ')}]`, "system");
      saveConfigToServer();
    });
    checklistEl.appendChild(label);
  });
}

function updateFinOpsMetrics() {
  document.getElementById('val-verizon-budget-finops').innerText = `$${STATE.verizonBudget.toLocaleString()}`;
  document.getElementById('val-total-spend-finops').innerText = `$${STATE.totalSpend.toFixed(2)}`;
  document.getElementById('val-total-saved-finops').innerText = `$${STATE.totalSaved.toFixed(2)}`;
  
  const variance = STATE.verizonBudget - STATE.totalSpend;
  document.getElementById('val-variance-finops').innerText = `$${variance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  
  const efficiency = STATE.totalSpend + STATE.totalSaved > 0 
    ? (STATE.totalSaved / (STATE.totalSpend + STATE.totalSaved)) * 100 
    : 0;
  document.getElementById('val-efficiency-finops').innerText = `${efficiency.toFixed(1)}%`;
}

function logPlaygroundConsole(source, msg, type = 'system') {
  const consolePanel = document.getElementById('playground-console');
  if (!consolePanel) return;
  const timestamp = new Date().toLocaleTimeString();
  
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.innerHTML = `<span class="timestamp">[${timestamp}]</span><strong>[${source}]</strong> ${msg}`;
  
  consolePanel.appendChild(line);
  consolePanel.scrollTop = consolePanel.scrollHeight;
}

// ----------------------------------------------------
// DYNAMIC TOPOLOGY NOC dashboard logic
// ----------------------------------------------------
function initTopologyGraph() {
  const svg = document.getElementById('topology-svg');
  svg.addEventListener('mousedown', onSvgMouseDown);
  svg.addEventListener('mousemove', onSvgMouseMove);
  svg.addEventListener('mouseup', onSvgMouseUp);
  
  document.getElementById('btn-topo-add').addEventListener('click', spawnNewAgentNode);
  document.getElementById('btn-topo-connect').addEventListener('click', toggleConnectMode);
  document.getElementById('btn-topo-delete').addEventListener('click', deleteSelectedElement);
  
  drawTopology();
}

function drawTopology() {
  const svg = document.getElementById('topology-svg');
  if (!svg) return;
  svg.innerHTML = '';
  
  // 1. Draw Links
  STATE.topology.links.forEach((link, idx) => {
    const fromNode = STATE.topology.nodes[link.from];
    const toNode = STATE.topology.nodes[link.to];
    
    if (fromNode && toNode) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      const isSelected = STATE.graphState.selectedLinkId === idx;
      
      line.setAttribute("x1", fromNode.x);
      line.setAttribute("y1", fromNode.y);
      line.setAttribute("x2", toNode.x);
      line.setAttribute("y2", toNode.y);
      line.setAttribute("class", `topo-link ${isSelected ? 'selected' : ''}`);
      line.setAttribute("data-link-index", idx);
      
      line.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        selectLink(idx);
      });
      svg.appendChild(line);
    }
  });
  
  // 2. Draw Packet Dots
  STATE.topology.links.forEach((link) => {
    const fromNode = STATE.topology.nodes[link.from];
    const toNode = STATE.topology.nodes[link.to];
    
    if (fromNode && toNode) {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("r", "5");
      circle.setAttribute("cx", fromNode.x);
      circle.setAttribute("cy", fromNode.y);
      circle.setAttribute("class", "packet-dot");
      circle.setAttribute("id", `packet-${link.from}-${link.to}`);
      
      circle.innerHTML = `
        <animate id="anim-${link.from}-${link.to}-x" attributeName="cx" from="${fromNode.x}" to="${toNode.x}" dur="0.8s" fill="freeze" begin="indefinite" />
        <animate id="anim-${link.from}-${link.to}-y" attributeName="cy" from="${fromNode.y}" to="${toNode.y}" dur="0.8s" fill="freeze" begin="indefinite" />
      `;
      svg.appendChild(circle);
      
      const revCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      revCircle.setAttribute("r", "5");
      revCircle.setAttribute("cx", toNode.x);
      revCircle.setAttribute("cy", toNode.y);
      revCircle.setAttribute("class", "packet-dot");
      revCircle.setAttribute("id", `packet-${link.to}-${link.from}`);
      revCircle.innerHTML = `
        <animate id="anim-${link.to}-${link.from}-x" attributeName="cx" from="${toNode.x}" to="${fromNode.x}" dur="0.8s" fill="freeze" begin="indefinite" />
        <animate id="anim-${link.to}-${link.from}-y" attributeName="cy" from="${toNode.y}" to="${fromNode.y}" dur="0.8s" fill="freeze" begin="indefinite" />
      `;
      svg.appendChild(revCircle);
    }
  });

  // 3. Draw Nodes
  Object.values(STATE.topology.nodes).forEach(node => {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const isSelected = STATE.graphState.selectedNodeId === node.id;
    
    group.setAttribute("class", `topo-node ${isSelected ? 'selected' : ''}`);
    group.setAttribute("id", `node-${node.id}`);
    
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", node.x);
    circle.setAttribute("cy", node.y);
    circle.setAttribute("r", node.r || 28);
    
    const textLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    textLabel.setAttribute("x", node.x);
    textLabel.setAttribute("y", node.y + 4);
    textLabel.textContent = node.label;
    
    const textSub = document.createElementNS("http://www.w3.org/2000/svg", "text");
    textSub.setAttribute("x", node.x);
    textSub.setAttribute("y", node.y + node.r + 14);
    textSub.setAttribute("class", "node-sub-text");
    textSub.textContent = node.subLabel || '';

    group.appendChild(circle);
    group.appendChild(textLabel);
    group.appendChild(textSub);
    
    group.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      onNodeMouseDown(e, node.id);
    });
    svg.appendChild(group);
  });
  
  const btnDelete = document.getElementById('btn-topo-delete');
  if (STATE.graphState.selectedNodeId || STATE.graphState.selectedLinkId !== null) {
    btnDelete.removeAttribute('disabled');
  } else {
    btnDelete.setAttribute('disabled', 'true');
  }
}

function selectLink(idx) {
  STATE.graphState.selectedLinkId = idx;
  STATE.graphState.selectedNodeId = null;
  document.getElementById('topo-status-tip').innerText = `Selected Link: Route Channel connection (index ${idx}).`;
  
  // Hide details drawer
  document.getElementById('drawer-placeholder').style.display = 'flex';
  document.getElementById('drawer-inputs').style.display = 'none';
  
  drawTopology();
}

function getSvgCoords(e) {
  const svg = document.getElementById('topology-svg');
  const rect = svg.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

function onNodeMouseDown(e, nodeId) {
  if (STATE.graphState.connectMode) {
    if (!STATE.graphState.connectSourceNodeId) {
      STATE.graphState.connectSourceNodeId = nodeId;
      document.getElementById('topo-status-tip').innerText = `Source Node: ${STATE.topology.nodes[nodeId].label}. Now click Target Node...`;
    } else {
      const targetId = nodeId;
      const sourceId = STATE.graphState.connectSourceNodeId;
      
      if (sourceId === targetId) {
        alert("Cannot connect a node to itself.");
        resetConnectMode();
        return;
      }
      
      const dup = STATE.topology.links.some(l => (l.from === sourceId && l.to === targetId) || (l.from === targetId && l.to === sourceId));
      if (dup) {
        alert("A connection already exists between these agents.");
        resetConnectMode();
        return;
      }
      
      STATE.topology.links.push({ from: sourceId, to: targetId });
      logPlaygroundConsole("Control Plane", `Established route communication channel between Node '${STATE.topology.nodes[sourceId].label}' and Node '${STATE.topology.nodes[targetId].label}'.`, "system");
      resetConnectMode();
      saveConfigToServer();
    }
    return;
  }
  
  STATE.graphState.draggedNodeId = nodeId;
  selectAgent(nodeId);
}

function onSvgMouseDown(e) {
  STATE.graphState.selectedNodeId = null;
  STATE.graphState.selectedLinkId = null;
  
  // Hide details drawer inputs
  document.getElementById('drawer-placeholder').style.display = 'flex';
  document.getElementById('drawer-inputs').style.display = 'none';
  
  drawTopology();
}

function onSvgMouseMove(e) {
  if (STATE.graphState.draggedNodeId) {
    const node = STATE.topology.nodes[STATE.graphState.draggedNodeId];
    if (node) {
      const coords = getSvgCoords(e);
      node.x = Math.max(40, Math.min(760, coords.x));
      node.y = Math.max(40, Math.min(440, coords.y));
      drawTopology();
    }
  }
}

function onSvgMouseUp(e) {
  if (STATE.graphState.draggedNodeId) {
    STATE.graphState.draggedNodeId = null;
    saveConfigToServer(); // Save arranged positions
  }
}

function toggleConnectMode() {
  const btn = document.getElementById('btn-topo-connect');
  const svg = document.getElementById('topology-svg');
  
  if (!STATE.graphState.connectMode) {
    STATE.graphState.connectMode = true;
    STATE.graphState.connectSourceNodeId = null;
    btn.classList.add('danger');
    btn.innerText = "Cancel Connect";
    svg.classList.add('connecting');
    document.getElementById('topo-status-tip').innerText = "Connecting Mode: Click Source Node to begin channel link.";
  } else {
    resetConnectMode();
  }
}

function resetConnectMode() {
  const btn = document.getElementById('btn-topo-connect');
  const svg = document.getElementById('topology-svg');
  STATE.graphState.connectMode = false;
  STATE.graphState.connectSourceNodeId = null;
  btn.classList.remove('danger');
  btn.innerText = "Connect Nodes";
  svg.classList.remove('connecting');
  document.getElementById('topo-status-tip').innerText = "Tip: Drag nodes to rearrange. Click to select.";
  drawTopology();
}

function spawnNewAgentNode() {
  const name = prompt("Enter registration label for the new Agent Node:", "Security-Audit");
  if (!name || name.trim() === '') return;
  
  const cleanId = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  if (STATE.agents[cleanId]) {
    alert("An agent with this ID/Name already exists in the registry.");
    return;
  }
  
  STATE.topology.nodes[cleanId] = {
    id: cleanId,
    label: name,
    subLabel: `${name} Agent`,
    x: 400,
    y: 240,
    r: 28
  };
  
  STATE.agents[cleanId] = {
    id: cleanId,
    name: `${name} Agent`,
    bu: 'NetworkOps',
    model: 'Claude 3.5 Sonnet',
    budget: 50.00,
    currentSpend: 0.00,
    retryLimit: 3,
    runawayLimit: 4,
    authorizedTools: ['db_query'],
    template: 'Execute custom policy auditor routines.'
  };
  
  logPlaygroundConsole("Control Plane", `Registered new node agent '${name}' in registry. Fleet updated.`, "system");
  
  selectAgent(cleanId);
  saveConfigToServer();
}

function deleteSelectedElement() {
  if (STATE.graphState.selectedNodeId) {
    const nodeId = STATE.graphState.selectedNodeId;
    
    if (['telemetry-agent', 'delphi-rca', 'knowledge-ai'].includes(nodeId)) {
      if (!confirm("This is a critical system fleet agent. Deleting it will cause simulation routing failures. Proceed?")) {
        return;
      }
    }
    
    delete STATE.topology.nodes[nodeId];
    delete STATE.agents[nodeId];
    
    STATE.topology.links = STATE.topology.links.filter(l => l.from !== nodeId && l.to !== nodeId);
    logPlaygroundConsole("Control Plane", `De-registered node agent '${nodeId}' and removed all associated routing links.`, "alert");
    STATE.graphState.selectedNodeId = null;
    
    saveConfigToServer();
    
    const remaining = Object.keys(STATE.agents);
    if (remaining.length > 0) {
      selectAgent(remaining[0]);
    } else {
      drawTopology();
    }
    
  } else if (STATE.graphState.selectedLinkId !== null) {
    const idx = STATE.graphState.selectedLinkId;
    const link = STATE.topology.links[idx];
    
    STATE.topology.links.splice(idx, 1);
    logPlaygroundConsole("Control Plane", `Disconnected route channel connection between '${link.from}' and '${link.to}'.`, "alert");
    
    STATE.graphState.selectedLinkId = null;
    drawTopology();
    saveConfigToServer();
  }
}

function runPacketAnimation(fromId, toId) {
  const animX = document.getElementById(`anim-${fromId}-${toId}-x`);
  const animY = document.getElementById(`anim-${fromId}-${toId}-y`);
  const dot = document.getElementById(`packet-${fromId}-${toId}`);
  
  if (animX && animY && dot) {
    dot.classList.add('active');
    animX.beginElement();
    animY.beginElement();
    setTimeout(() => {
      dot.classList.remove('active');
    }, 800);
  }
}

// ----------------------------------------------------
// Structured Interaction Trace formatting (JSON syntax highlighter)
// ----------------------------------------------------
function syntaxHighlight(json) {
  if (typeof json !== 'string') {
    json = JSON.stringify(json, undefined, 2);
  }
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, function (match) {
    var cls = 'trace-number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'trace-key';
        return '<span class="' + cls + '">' + match.replace(/:$/, '') + '</span>:';
      } else {
        cls = 'trace-string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'trace-boolean';
    } else if (/null/.test(match)) {
      cls = 'trace-null';
    }
    return '<span class="' + cls + '">' + match + '</span>';
  });
}

// ----------------------------------------------------
// Target Rules Registry View Builder
// ----------------------------------------------------
function renderTargetingRules() {
  const container = document.getElementById('targeting-rules-list');
  if (!container) return;
  container.innerHTML = '';
  
  STATE.targetingRules.forEach((rule, idx) => {
    const card = document.createElement('div');
    card.className = 'rule-card';
    card.innerHTML = `
      <div class="rule-header">
        <span>Rule ID: ${rule.id}</span>
        <button class="btn-delete-rule" data-id="${rule.id}" title="Delete targeting override override rule">✖</button>
      </div>
      <div class="rule-body">
        <div class="rule-row">
          <span>IF context attribute</span>
          <select class="rule-attr" data-idx="${idx}">
            <option value="region" ${rule.attribute === 'region' ? 'selected' : ''}>region</option>
            <option value="userRole" ${rule.attribute === 'userRole' ? 'selected' : ''}>userRole</option>
            <option value="cost" ${rule.attribute === 'cost' ? 'selected' : ''}>cost</option>
          </select>
          <select class="rule-operator" data-idx="${idx}">
            <option value="equals" ${rule.operator === 'equals' ? 'selected' : ''}>equals</option>
            <option value="contains" ${rule.operator === 'contains' ? 'selected' : ''}>contains</option>
          </select>
          <input type="text" class="rule-val" value="${rule.value}" data-idx="${idx}" style="flex:1;">
        </div>
        <div class="rule-row">
          <span>THEN force action</span>
          <select class="rule-action" data-idx="${idx}">
            <option value="route_override" ${rule.action === 'route_override' ? 'selected' : ''}>route_override (Change Model)</option>
            <option value="force_hitl" ${rule.action === 'force_hitl' ? 'selected' : ''}>force_hitl (Requires Approval)</option>
            <option value="route_tier" ${rule.action === 'route_tier' ? 'selected' : ''}>route_tier (Force Tier)</option>
          </select>
          <input type="text" class="rule-action-val" value="${rule.actionValue}" data-idx="${idx}" style="flex:1;">
        </div>
      </div>
    `;
    
    // Bind deletes
    card.querySelector('.btn-delete-rule').addEventListener('click', () => {
      STATE.targetingRules.splice(idx, 1);
      renderTargetingRules();
      saveConfigToServer();
      logPlaygroundConsole("Targeting Rules", `Removed policy override rule: ${rule.id}`, "system");
    });
    
    // Bind edits
    card.querySelector('.rule-attr').addEventListener('change', (e) => {
      STATE.targetingRules[idx].attribute = e.target.value;
      saveConfigToServer();
    });
    card.querySelector('.rule-operator').addEventListener('change', (e) => {
      STATE.targetingRules[idx].operator = e.target.value;
      saveConfigToServer();
    });
    card.querySelector('.rule-val').addEventListener('change', (e) => {
      STATE.targetingRules[idx].value = e.target.value;
      saveConfigToServer();
    });
    card.querySelector('.rule-action').addEventListener('change', (e) => {
      STATE.targetingRules[idx].action = e.target.value;
      saveConfigToServer();
    });
    card.querySelector('.rule-action-val').addEventListener('change', (e) => {
      STATE.targetingRules[idx].actionValue = e.target.value;
      saveConfigToServer();
    });
    
    container.appendChild(card);
  });
}

// ----------------------------------------------------
// Telemetry Span Tree & Telemetry Inspector
// ----------------------------------------------------
function initMockTraces() {
  // Add some mock logs to start with, showing system checks
  STATE.traces = [
    {
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      trace_id: "TX-90812A",
      active_agent: "telemetry-agent",
      prompt_payload: "Process 1,200 router interface alarm logs from Northeast edge systems.",
      version: "v1.2 (Stable)",
      routing_tier: "Tier 1",
      telemetry: {
        latency_ms: 120,
        execution_cost_usd: 0.01,
        context_tokens: 480,
        outcome: "SUCCESSFUL_RESOLUTION"
      },
      steps: [
        "REST Request captured. Agent: Telemetry Fusion Agent",
        "Guardrail compliance passed.",
        "Targeting rules evaluated. Routing path: Tier 1.",
        "Executing telemetry correlation scan. Interfaces isolated.",
        "Frontier LLM resolution compiled successfully."
      ],
      spans: [
        { id: "s1", name: "API Gateway proxy execution", parent_id: null, start_time: 0, end_time: 120, status: "SUCCESS" },
        { id: "s2", name: "Guardrail Scan", parent_id: "s1", start_time: 2, end_time: 15, status: "SUCCESS" },
        { id: "s3", name: "Targeting Rules evaluation", parent_id: "s1", start_time: 15, end_time: 18, status: "SUCCESS" },
        { id: "s4", name: "Correlation Engine execution", parent_id: "s1", start_time: 20, end_time: 110, status: "SUCCESS" },
        { id: "s5", name: "LLM Generation", parent_id: "s1", start_time: 110, end_time: 120, status: "SUCCESS" }
      ],
      judges: { safety: 100, format: 100, cost: 98 }
    },
    {
      timestamp: new Date(Date.now() - 7200000).toISOString(),
      trace_id: "TX-88127B",
      active_agent: "delphi-rca",
      prompt_payload: "Investigate incident ticket #RCA-9082: Root cause analysis of packet loss on Northeast core router.",
      version: "v1.2 (Stable)",
      routing_tier: "Tier 3",
      telemetry: {
        latency_ms: 840,
        execution_cost_usd: 0.45,
        context_tokens: 14200,
        outcome: "SUCCESSFUL_RESOLUTION"
      },
      steps: [
        "REST Request captured. Agent: Delphi RCA Agent",
        "Guardrail compliance passed.",
        "Supervisor authorization required for Tool write.",
        "Supervisor APPROVED write permission.",
        "BGP Router Config write executed successfully.",
        "Frontier LLM resolution compiled."
      ],
      spans: [
        { id: "s1", name: "API Gateway proxy execution", parent_id: null, start_time: 0, end_time: 840, status: "SUCCESS" },
        { id: "s2", name: "Guardrail Scan", parent_id: "s1", start_time: 1, end_time: 8, status: "SUCCESS" },
        { id: "s3", name: "Targeting Rules evaluation", parent_id: "s1", start_time: 8, end_time: 10, status: "SUCCESS" },
        { id: "s4", name: "LLM Generation (o1-pro)", parent_id: "s1", start_time: 12, end_time: 835, status: "SUCCESS" },
        { id: "s5", name: "Tool Execute: BGP Router Config write", parent_id: "s4", start_time: 50, end_time: 820, status: "SUCCESS" },
        { id: "s6", name: "Human-in-the-Loop approval hold", parent_id: "s5", start_time: 52, end_time: 800, status: "SUCCESS" }
      ],
      judges: { safety: 98, format: 97, cost: 10 }
    }
  ];
  
  renderTracesTable();
  if (STATE.traces.length > 0) {
    selectTrace(STATE.traces[0].trace_id);
  }
}

function renderTracesTable() {
  const tbody = document.getElementById('trace-list-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  STATE.traces.forEach(trace => {
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', trace.trace_id);
    if (trace.trace_id === STATE.activeTraceId) {
      tr.className = 'active';
    }
    
    const timeStr = new Date(trace.timestamp).toLocaleTimeString();
    const agentName = STATE.agents[trace.active_agent] ? STATE.agents[trace.active_agent].name : trace.active_agent;
    const isSuccess = trace.telemetry.outcome === 'SUCCESSFUL_RESOLUTION' || trace.telemetry.outcome === 'SUCCESS';
    
    tr.innerHTML = `
      <td>${timeStr}</td>
      <td style="font-family:'JetBrains Mono', monospace; font-size:12px; font-weight:700;">${trace.trace_id}</td>
      <td>${agentName}</td>
      <td>
        <span class="trace-tree-status-badge ${isSuccess ? 'success' : 'failed'}">
          ${trace.telemetry.outcome.replace('_RESOLUTION', '')}
        </span>
      </td>
      <td>${trace.telemetry.latency_ms} ms</td>
      <td style="color:var(--tier-1-color); font-weight:600;">$${trace.telemetry.execution_cost_usd.toFixed(4)}</td>
    `;
    
    tr.addEventListener('click', () => {
      selectTrace(trace.trace_id);
    });
    tbody.appendChild(tr);
  });
}

function selectTrace(traceId) {
  STATE.activeTraceId = traceId;
  renderTracesTable();
  
  const trace = STATE.traces.find(t => t.trace_id === traceId);
  if (!trace) return;
  
  // Update JSON Box
  document.getElementById('trace-json-box').innerHTML = syntaxHighlight(trace);
  
  // Render Span Tree Visualizer
  renderSpanTree(trace);
  
  // Update Judges metrics
  if (trace.judges) {
    document.getElementById('lbl-live-judge-outcome').innerText = trace.telemetry.outcome === 'SUCCESSFUL_RESOLUTION' ? 'PASSED' : 'FLAGGED';
    document.getElementById('lbl-live-judge-outcome').style.color = trace.telemetry.outcome === 'SUCCESSFUL_RESOLUTION' ? 'var(--accent-green)' : 'var(--accent-red)';
    
    document.getElementById('lbl-judge-safety').innerText = `${trace.judges.safety}%`;
    document.getElementById('bar-judge-safety').style.width = `${trace.judges.safety}%`;
    
    document.getElementById('lbl-judge-format').innerText = `${trace.judges.format}%`;
    document.getElementById('bar-judge-format').style.width = `${trace.judges.format}%`;
    
    document.getElementById('lbl-judge-cost').innerText = `${trace.judges.cost}%`;
    document.getElementById('bar-judge-cost').style.width = `${trace.judges.cost}%`;
  }
}

function renderSpanTree(trace) {
  const container = document.getElementById('trace-tree-container');
  if (!container) return;
  container.innerHTML = '';
  
  const spans = trace.spans || [];
  if (spans.length === 0) {
    container.innerHTML = '<span class="placeholder-text">No telemetric span tree records available for this run.</span>';
    return;
  }
  
  // Map parent-child spans recursively
  const spanMap = {};
  spans.forEach(s => {
    spanMap[s.id] = { ...s, children: [] };
  });
  
  const rootSpans = [];
  spans.forEach(s => {
    if (s.parent_id && spanMap[s.parent_id]) {
      spanMap[s.parent_id].children.push(spanMap[s.id]);
    } else {
      rootSpans.push(spanMap[s.id]);
    }
  });
  
  // Recursively build tree DOM elements
  function buildSpanNodeDOM(node, isRoot = false) {
    const nodeDiv = document.createElement('div');
    nodeDiv.className = `trace-tree-node ${isRoot ? 'root' : ''}`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'trace-tree-content';
    
    const hasChildren = node.children.length > 0;
    const duration = node.end_time !== null ? `${node.end_time - node.start_time} ms` : 'Active';
    
    contentDiv.innerHTML = `
      <span class="trace-tree-toggle">${hasChildren ? '▼' : '•'}</span>
      <span class="trace-tree-icon" style="color: ${node.status === 'SUCCESS' ? 'var(--accent-green)' : 'var(--accent-red)'}"></span>
      <span class="trace-tree-name">${node.name}</span>
      <span class="trace-tree-duration">${duration}</span>
      <span class="trace-tree-status-badge ${node.status === 'SUCCESS' ? 'success' : 'failed'}">${node.status}</span>
    `;
    
    nodeDiv.appendChild(contentDiv);
    
    if (hasChildren) {
      const childrenDiv = document.createElement('div');
      childrenDiv.className = 'trace-tree-children';
      node.children.forEach(child => {
        childrenDiv.appendChild(buildSpanNodeDOM(child));
      });
      nodeDiv.appendChild(childrenDiv);
      
      // Click event toggle collapse
      contentDiv.querySelector('.trace-tree-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        const collapsed = childrenDiv.classList.toggle('collapsed');
        e.target.innerText = collapsed ? '▶' : '▼';
      });
    }
    
    return nodeDiv;
  }
  
  rootSpans.forEach(root => {
    container.appendChild(buildSpanNodeDOM(root, true));
  });
}

// ----------------------------------------------------
// Real Live Execution Gateway Client (Sandbox Prompt Playground)
// ----------------------------------------------------
async function runPlaygroundSandbox() {
  if (STATE.isKillSwitchActive) {
    alert("Emergency Shutdown is currently active! Please reset the command plane channels before executing any new runs.");
    return;
  }
  if (STATE.isApprovalPending) {
    alert("Human-in-the-Loop approval is pending. Please respond to the current request.");
    return;
  }
  
  const agent = STATE.agents[STATE.activeAgentId];
  const userPrompt = document.getElementById('playground-prompt-input').value;
  
  // Clear dashboard actives
  document.querySelectorAll('.tier-card').forEach(el => el.classList.remove('active'));
  clearTopologyHighlight();
  
  logPlaygroundConsole("Playground Sandbox", `Dispatching execute command on ${STATE.globalPromptVersion}. Agent: ${agent.name}`, "system");
  
  // Dynamic topology link routing check
  if (agent.id === 'delphi-rca') {
    logPlaygroundConsole("Topology Route Check", "Tracing routing links... Path: Telemetry -> Delphi RCA", "check");
    const telemetryToDelphi = STATE.topology.links.some(l => (l.from === 'telemetry-agent' && l.to === 'delphi-rca') || (l.from === 'delphi-rca' && l.to === 'telemetry-agent'));
    
    if (!telemetryToDelphi) {
      logPlaygroundConsole("Topology Route Check", "[ROUTING ERROR] Telemetry node has no connection link to Delphi RCA Agent. Execution aborted.", "alert");
      const telNode = document.getElementById('node-telemetry-agent');
      if (telNode) telNode.setAttribute("class", `topo-node active alert`);
      return;
    }
  }

  // Set up payload
  let toolCall = null;
  if (agent.id === 'delphi-rca' && (userPrompt.toLowerCase().includes("rca") || userPrompt.toLowerCase().includes("bgp"))) {
    toolCall = {
      name: 'bgp_router_write',
      action: 'Apply route loop AS-65001 filter'
    };
  }
  
  const startTime = Date.now();
  
  // Local active highlight
  const nodeEl = document.getElementById(`node-${agent.id}`);
  if (nodeEl) nodeEl.setAttribute("class", `topo-node active`);
  
  fetch('/api/agent/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: agent.id,
      prompt: userPrompt,
      toolCall
    })
  })
  .then(async (response) => {
    const latency = Date.now() - startTime;
    const isOk = response.ok;
    const data = await response.json();
    
    if (isOk) {
      let tier = data.tier || "Tier 3";
      let contextTokens = 14200;
      if (tier.includes("Tier 0")) {
        contextTokens = 150;
      } else if (tier.includes("Tier 1")) {
        contextTokens = 480;
      } else if (tier.includes("Tier 2")) {
        contextTokens = 2100;
      } else if (tier.includes("Tier 3 (Fallback)")) {
        contextTokens = 8500;
      } else if (tier.includes("Tier 3")) {
        contextTokens = 14200;
      }
      
      // Highlight tier card on Topology view
      const tierId = tier.toLowerCase().includes("tier 0") ? "tier0" : (tier.toLowerCase().includes("tier 1") ? "tier1" : (tier.toLowerCase().includes("tier 2") ? "tier2" : "tier3"));
      const tierCard = document.getElementById(`card-${tierId}`);
      if (tierCard) tierCard.classList.add('active');
      
      logPlaygroundConsole("Execution", `Resolution: ${data.resolution}`, "success");
      
      // Save trace object
      const newTrace = {
        timestamp: new Date().toISOString(),
        trace_id: `TX-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        active_agent: agent.id,
        prompt_payload: userPrompt,
        version: STATE.globalPromptVersion,
        routing_tier: tier,
        telemetry: {
          latency_ms: latency,
          execution_cost_usd: data.cost || 0.00,
          context_tokens: contextTokens,
          outcome: "SUCCESSFUL_RESOLUTION"
        },
        steps: data.steps.map(s => s.text || s),
        spans: data.spans || [],
        judges: data.judges || { safety: 100, format: 100, cost: 95 }
      };
      
      STATE.traces.unshift(newTrace);
      renderTracesTable();
      selectTrace(newTrace.trace_id);
    } else {
      let errorMsg = data.message || data.error || "Gateway execution failed";
      logPlaygroundConsole("Control Plane", `Blocked: ${errorMsg}`, "alert");
      
      let outcome = "FAILED";
      if (response.status === 403) outcome = "BLOCKED_BY_POLICY";
      else if (response.status === 402) outcome = "BUDGET_BREACHED";
      else if (response.status === 503) outcome = "CONTROL_PLANE_OFFLINE";
      
      // Save failed trace object
      const failedTrace = {
        timestamp: new Date().toISOString(),
        trace_id: `TX-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        active_agent: agent.id,
        prompt_payload: userPrompt,
        version: STATE.globalPromptVersion,
        routing_tier: "N/A",
        telemetry: {
          latency_ms: latency,
          execution_cost_usd: 0.00,
          context_tokens: 0,
          outcome: outcome
        },
        steps: data.steps ? data.steps.map(s => s.text || s) : [{text: errorMsg}],
        spans: data.spans || [],
        judges: { safety: 50, format: 50, cost: 100 }
      };
      
      STATE.traces.unshift(failedTrace);
      renderTracesTable();
      selectTrace(failedTrace.trace_id);
      
      if (response.status === 403 && (userPrompt.toLowerCase().includes("continuously poll") || userPrompt.toLowerCase().includes("infinite loop"))) {
        // Runaway loop triggered kill switch overlay
        triggerEmergencyKillSwitch(agent, "runaway");
      }
    }
  })
  .catch((err) => {
    console.error("Execution error", err);
    logPlaygroundConsole("Control Plane", `Server Error: ${err.message}`, "alert");
  });
}

// ----------------------------------------------------
// Offline Evaluations & Evals Benchmark Sweep
// ----------------------------------------------------
async function runEvaluationSweep() {
  const btn = document.getElementById('btn-run-evals');
  const statusText = document.getElementById('eval-status-text');
  
  btn.setAttribute('disabled', 'true');
  statusText.innerText = "Running 10 test case evaluations...";
  logPlaygroundConsole("Evals Engine", "Starting offline evaluation benchmarking sweep. Dataset: 'NOC-RCA-Standard-100'.", "system");
  
  const bars = {
    satV1: document.getElementById('bar-eval-sat-v1'),
    satV2: document.getElementById('bar-eval-sat-v2'),
    latV1: document.getElementById('bar-eval-lat-v1'),
    latV2: document.getElementById('bar-eval-lat-v2'),
    lblSatV1: document.getElementById('lbl-eval-sat-v1'),
    lblSatV2: document.getElementById('lbl-eval-sat-v2'),
    lblLatV1: document.getElementById('lbl-eval-lat-v1'),
    lblLatV2: document.getElementById('lbl-eval-lat-v2'),
    lblCostV1: document.getElementById('lbl-eval-cost-v1'),
    lblCostV2: document.getElementById('lbl-eval-cost-v2')
  };

  await delay(600);
  statusText.innerText = "Evaluating: 20% complete...";
  updateBars(20, 30, 20, 10);
  
  await delay(600);
  statusText.innerText = "Evaluating: 50% complete...";
  updateBars(55, 62, 50, 20);
  
  await delay(600);
  statusText.innerText = "Evaluating: 80% complete...";
  updateBars(80, 88, 75, 25);
  
  await delay(600);
  statusText.innerText = "Evals Completed.";
  
  bars.lblSatV1.innerText = "89.2%";
  bars.satV1.style.width = "89.2%";
  bars.lblSatV2.innerText = "96.4%";
  bars.satV2.style.width = "96.4%";
  
  bars.lblLatV1.innerText = "324 ms";
  bars.latV1.style.width = "65%";
  bars.lblLatV2.innerText = "128 ms";
  bars.latV2.style.width = "26%";
  
  bars.lblCostV1.innerText = "$0.08 /decision";
  bars.lblCostV2.innerText = "$0.04 /decision";

  logPlaygroundConsole("Evals Engine", "Evaluation completed. Prompt v2 has 7.2% higher satisfaction and 60% lower latency.", "success");
  logPlaygroundConsole("Evals Engine", "FinOps Recommendation: Promote Candidate Prompt v2. Estimated monthly Verizon spend reduction: $2,400.", "success");
  
  document.getElementById('btn-promote-canary').removeAttribute('disabled');
  btn.removeAttribute('disabled');

  function updateBars(sat1, sat2, lat1, lat2) {
    bars.satV1.style.width = sat1 + "%";
    bars.satV2.style.width = sat2 + "%";
    bars.latV1.style.width = lat1 + "%";
    bars.latV2.style.width = lat2 + "%";
    bars.lblSatV1.innerText = sat1 + "%";
    bars.lblSatV2.innerText = sat2 + "%";
    bars.lblLatV1.innerText = lat1 * 5 + " ms";
    bars.lblLatV2.innerText = lat2 * 5 + " ms";
  }
}

function promoteCanaryVariant() {
  STATE.globalPromptVersion = "v1.3 (Stable)";
  
  document.getElementById('flag-rollout').value = 100;
  document.getElementById('lbl-flag-rollout').innerText = "100% Canary";
  
  logPlaygroundConsole("Control Plane", "Prompt Version v2 successfully promoted to 100% Stable Production. Retracted v1 paths.", "success");
  
  document.getElementById('btn-promote-canary').setAttribute('disabled', 'true');
  document.getElementById('eval-status-text').innerText = "Promoted v2 to 100% Prod";
  
  saveConfigToServer();
}

function resolveHITL(approved) {
  if (STATE.activeTxId) {
    fetch('/api/harness/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txId: STATE.activeTxId, approved })
    }).then(() => {
      document.getElementById('approval-overlay').style.display = 'none';
      STATE.isApprovalPending = false;
      STATE.activeTxId = null;
    }).catch(err => console.error("Error resolving HITL", err));
  }
}

function triggerEmergencyKillSwitch(agent, cause = "shutdown") {
  STATE.isKillSwitchActive = true;
  document.getElementById('kill-switch-screen').style.display = 'flex';
  
  const statusIndicator = document.getElementById('fleet-status-indicator');
  statusIndicator.className = 'fleet-status-indicator offline';
  document.getElementById('txt-fleet-status').innerText = 'FLEET OFFLINE';

  const titleEl = document.getElementById('kill-switch-title');
  const descEl = document.getElementById('kill-switch-desc');

  if (cause === 'runaway') {
    titleEl.innerText = "KILL SWITCH ENGAGED";
    descEl.innerHTML = `
      Harness Protection Controls intercepted runaway execution.<br>
      The loop threshold limit was reached.<br>
      API requests terminated automatically to protect Verizon budget from infinite token consumption.
    `;
    const delphiNode = document.getElementById('node-delphi-rca');
    if (delphiNode) {
      delphiNode.setAttribute("class", `topo-node active alert`);
    }
  } else {
    titleEl.innerText = "FLEET SHUTDOWN ACTIVE";
    descEl.innerHTML = `
      <strong>ADMINISTRATIVE CONTROL OVERRIDE TRIGGERED</strong>.<br>
      Global control plane has suspended all active agent loops and tools permissions.
      Routing paths locked down.
    `;
    clearTopologyHighlight();
    document.querySelectorAll('.topo-node').forEach(n => n.setAttribute("class", `topo-node active alert`));
  }
}

function triggerGlobalShutdown() {
  fetch('/api/harness/shutdown', { method: 'POST' })
    .then(() => {
      logPlaygroundConsole("Security Override", "Global emergency shutdown triggered. Fleet deactivated.", "alert");
    })
    .catch(err => console.error(err));
}

function resetKillSwitch() {
  fetch('/api/harness/reset-kill', { method: 'POST' })
    .then(() => {
      logPlaygroundConsole("Control Plane", "Fleet Command channels restored. System bus active.", "system");
    })
    .catch(err => console.error(err));
}

function clearTopologyHighlight() {
  document.querySelectorAll('.topo-node').forEach(n => {
    n.setAttribute("class", "topo-node");
  });
  document.querySelectorAll('.topo-link').forEach(l => {
    l.classList.remove('active');
  });
  document.querySelectorAll('.packet-dot').forEach(p => {
    p.classList.remove('active');
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Chart.js Rendering
function renderCharts() {
  const canvasTrend = document.getElementById('chart-spend-trend');
  if (!canvasTrend) return;
  const ctxTrend = canvasTrend.getContext('2d');
  
  STATE.charts.spendTrend = new Chart(ctxTrend, {
    type: 'line',
    data: {
      labels: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7', 'Day 8', 'Day 9', 'Day 10 (Current)'],
      datasets: [
        {
          label: 'Actual Spend ($)',
          data: [15, 30, 48, 62, 75, 88, 102, 118, 132, STATE.totalSpend],
          borderColor: '#ff3838',
          backgroundColor: 'rgba(255, 56, 56, 0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 2
        },
        {
          label: 'Projected Spend (No Cache Tuning)',
          data: [15, 32, 54, 76, 98, 120, 142, 168, 192, 220],
          borderColor: '#9a95b3',
          borderDash: [5, 5],
          fill: false,
          tension: 0.1,
          borderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#f3f1f9', font: { family: 'Outfit' } } }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9a95b3' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9a95b3' } }
      }
    }
  });

  const canvasBu = document.getElementById('chart-bu-spend');
  if (!canvasBu) return;
  const ctxBu = canvasBu.getContext('2d');
  
  const buLabels = Object.keys(STATE.buBudgets);
  const buBudgetData = buLabels.map(l => STATE.buBudgets[l].budget);
  const buSpendData = buLabels.map(l => STATE.buBudgets[l].spend);

  STATE.charts.buChart = new Chart(ctxBu, {
    type: 'bar',
    data: {
      labels: buLabels,
      datasets: [
        {
          label: 'BU Budget ($)',
          data: buBudgetData,
          backgroundColor: 'rgba(0, 240, 255, 0.4)',
          borderColor: '#00f0ff',
          borderWidth: 1
        },
        {
          label: 'BU Current Spend ($)',
          data: buSpendData,
          backgroundColor: 'rgba(255, 56, 56, 0.5)',
          borderColor: '#ff3838',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#f3f1f9', font: { family: 'Outfit' } } }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9a95b3' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9a95b3' } }
      }
    }
  });
}

function updateCharts() {
  if (STATE.charts.spendTrend) {
    const trendData = STATE.charts.spendTrend.data.datasets[0].data;
    trendData[trendData.length - 1] = STATE.totalSpend;
    STATE.charts.spendTrend.update();
  }
  if (STATE.charts.buChart) {
    const buLabels = Object.keys(STATE.buBudgets);
    STATE.charts.buChart.data.datasets[0].data = buLabels.map(l => STATE.buBudgets[l].budget);
    STATE.charts.buChart.data.datasets[1].data = buLabels.map(l => STATE.buBudgets[l].spend);
    STATE.charts.buChart.update();
  }
}

function updateKnowledgeCacheUI() {
  const cachePanel = document.getElementById('cache-list');
  if (!cachePanel) return;
  cachePanel.innerHTML = '';
  STATE.knowledgeCache.forEach(item => {
    const cacheEl = document.createElement('div');
    cacheEl.className = 'cache-item';
    cacheEl.innerHTML = `
      <span class="cache-item-query" title="${item.query}">${item.query}</span>
      <span class="cache-item-savings">+$${item.savings.toFixed(2)} saved</span>
    `;
    cachePanel.appendChild(cacheEl);
  });
}
