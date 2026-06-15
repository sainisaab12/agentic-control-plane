import os
import json
import asyncio
import random
import string
import time
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()

# ----------------------------------------------------
# Global Control Plane State (Enterprise Registry)
# ----------------------------------------------------
STATE = {
    "verizonBudget": 10000,
    "totalSpend": 145.20,
    "totalSaved": 32.40,
    "isKillSwitchActive": False,
    "isGlobalShutdown": False,
    
    # Control Flags
    "flags": {
        "guardrails": True,
        "fallback": True,
        "injectError": False,
        "rollout": 10
    },

    # Global policies
    "globalBudgetCap": 15000,
    "globalMaxConcurrency": 3,
    "globalRateLimit": 60,
    "globalPromptVersion": "v1.2 (Stable)",

    # Knowledge Cache (Continuous Learning)
    "knowledgeCache": [
        { "query": "Interface GigabitEthernet0/1/3 flapping on edge-router-vzw-04", "resolution": "Auto-disabled port, routed traffic to backup line B, ticket cleared.", "savings": 0.40 },
        { "query": "Retrieve network topology for region northeast-9", "resolution": "Static JSON retrieved from topology-db, 0 LLM tokens used.", "savings": 0.15 }
    ],
    
    # Tools Registry
    "tools": {
        "db_query": { "id": "db_query", "name": "Database Query", "cost": 0.00, "requiresApproval": False, "desc": "Query SQL configuration and active state databases." },
        "graph_traversal": { "id": "graph_traversal", "name": "Topology Graph Traversal", "cost": 0.00, "requiresApproval": False, "desc": "Traverse logical and physical topology logs." },
        "bgp_router_write": { "id": "bgp_router_write", "name": "BGP Router Config write", "cost": 0.05, "requiresApproval": True, "desc": "Apply routing policies, filters, or path modifications on edge systems." },
        "smtp_alert": { "id": "smtp_alert", "name": "SMTP Notification Service", "cost": 0.00, "requiresApproval": False, "desc": "Dispatch automated summary alerts to Operations teams." }
    },

    # Agents Registry (Design-Time configs)
    "agents": {
        "telemetry-agent": { "id": "telemetry-agent", "name": "Telemetry Fusion Agent", "bu": "NetworkOps", "model": "Claude 3.5 Sonnet", "budget": 50.00, "currentSpend": 12.45, "retryLimit": 3, "runawayLimit": 5, "authorizedTools": ["db_query", "graph_traversal"], "template": "Analyze alarm stream, correlate events across topology, and isolate issues.", "routingTier": "Tier 1" },
        "delphi-rca": { "id": "delphi-rca", "name": "Delphi RCA Agent", "bu": "NetSystems", "model": "o1-pro", "budget": 150.00, "currentSpend": 42.80, "retryLimit": 2, "runawayLimit": 3, "authorizedTools": ["db_query", "graph_traversal", "bgp_router_write", "smtp_alert"], "template": "Investigate incident [TICKET], trigger diagnostic scripts, recommend remediation.", "routingTier": "Tier 3" },
        "bizops-order": { "id": "bizops-order", "name": "BizOps Order Mesh", "bu": "OrderFulfillment", "model": "GPT-4o-mini", "budget": 30.00, "currentSpend": 4.15, "retryLimit": 4, "runawayLimit": 3, "authorizedTools": ["db_query"], "template": "Verify order status, inspect billing logs, flag exceptions.", "routingTier": "Tier 0" },
        "knowledge-ai": { "id": "knowledge-ai", "name": "Knowledge AI Engine", "bu": "SharedServices", "model": "GPT-4o", "budget": 40.00, "currentSpend": 8.20, "retryLimit": 3, "runawayLimit": 4, "authorizedTools": ["db_query"], "template": "Check semantic index for historical resolutions to match current incident.", "routingTier": "Tier 0" },
        "supervisor-orchestrator": { "id": "supervisor-orchestrator", "name": "Supervisor Orchestrator", "bu": "NetSystems", "model": "o1-pro", "budget": 200.00, "currentSpend": 0.00, "retryLimit": 2, "runawayLimit": 3, "authorizedTools": ["db_query", "graph_traversal", "bgp_router_write", "smtp_alert"], "template": "Orchestrate sub-agents (Telemetry, Delphi RCA, Knowledge) to coordinate network-wide diagnosis and resolution.", "routingTier": "Tier 3" },
        "secops-compliance": { "id": "secops-compliance", "name": "SecOps Compliance Agent", "bu": "Compliance", "model": "Claude 3.5 Sonnet", "budget": 60.00, "currentSpend": 0.00, "retryLimit": 3, "runawayLimit": 4, "authorizedTools": ["db_query", "smtp_alert"], "template": "Verify routing updates against enterprise compliance policies and authorize SMTP alerts.", "routingTier": "Tier 2" },
        "billing-sync": { "id": "billing-sync", "name": "Billing Reconciliation Agent", "bu": "OrderFulfillment", "model": "GPT-4o-mini", "budget": 40.00, "currentSpend": 0.00, "retryLimit": 4, "runawayLimit": 3, "authorizedTools": ["db_query"], "template": "Synchronize billing status across active accounting ledgers.", "routingTier": "Tier 1" }
    },

    # Dynamic Topology State
    "topology": {
        "nodes": {
            "telemetry-agent": { "id": "telemetry-agent", "label": "Telemetry", "subLabel": "Telemetry Agent", "x": 150, "y": 110, "r": 28 },
            "delphi-rca": { "id": "delphi-rca", "label": "Delphi RCA", "subLabel": "Investigation Fleet", "x": 350, "y": 80, "r": 32 },
            "bizops-order": { "id": "bizops-order", "label": "BizOps", "subLabel": "Order Mesh", "x": 150, "y": 210, "r": 28 },
            "knowledge-ai": { "id": "knowledge-ai", "label": "Knowledge", "subLabel": "Shared Index DB", "x": 550, "y": 150, "r": 32 },
            "supervisor-orchestrator": { "id": "supervisor-orchestrator", "label": "Supervisor", "subLabel": "Mesh Orchestrator", "x": 350, "y": 240, "r": 34 },
            "secops-compliance": { "id": "secops-compliance", "label": "Compliance", "subLabel": "Compliance Fleet", "x": 550, "y": 280, "r": 30 },
            "billing-sync": { "id": "billing-sync", "label": "Billing Sync", "subLabel": "Recon Agent", "x": 150, "y": 350, "r": 28 }
        },
        "links": [
            { "from": "telemetry-agent", "to": "delphi-rca" },
            { "from": "delphi-rca", "to": "knowledge-ai" },
            { "from": "bizops-order", "to": "knowledge-ai" },
            { "from": "supervisor-orchestrator", "to": "telemetry-agent" },
            { "from": "supervisor-orchestrator", "to": "delphi-rca" },
            { "from": "supervisor-orchestrator", "to": "secops-compliance" },
            { "from": "secops-compliance", "to": "knowledge-ai" },
            { "from": "bizops-order", "to": "billing-sync" }
        ]
    },
    
    # Business Unit Totals
    "buBudgets": {
        "NetworkOps": { "budget": 2000, "spend": 340 },
        "NetSystems": { "budget": 3000, "spend": 450 },
        "OrderFulfillment": { "budget": 1500, "spend": 120 },
        "SharedServices": { "budget": 1000, "spend": 80 },
        "Compliance": { "budget": 1000, "spend": 0 }
    },

    # Config parameters for the 4 tiers
    "tierConfigs": {
        "tier0": { "threshold": 85 },
        "tier1": { "accuracy": 80 },
        "tier2": { "temp": 3 },
        "tier3": { "effort": "medium" }
    },

    # Targeting Rules override policies
    "targetingRules": [
        { "id": "rule-1", "attribute": "region", "operator": "equals", "value": "northeast-edge", "action": "route_override", "actionValue": "o1-pro" },
        { "id": "rule-2", "attribute": "userRole", "operator": "equals", "value": "contractor", "action": "force_hitl", "actionValue": "True" }
    ]
}

TIER_COSTS = {
    "tier0": 0.00,
    "tier1": 0.01,
    "tier2": 0.05,
    "tier3": 0.40
}

# ----------------------------------------------------
# Active Concurrency Queue Manager
# ----------------------------------------------------
active_executions = 0
execution_queue = []

async def acquire_concurrency_slot(request_id: str):
    global active_executions
    if active_executions >= STATE["globalMaxConcurrency"]:
        future = asyncio.get_running_loop().create_future()
        execution_queue.append((request_id, future))
        broadcast_sse("QUEUE_UPDATE", {"active": active_executions, "depth": len(execution_queue)})
        await future
    active_executions += 1
    broadcast_sse("QUEUE_UPDATE", {"active": active_executions, "depth": len(execution_queue)})

def release_concurrency_slot():
    global active_executions
    active_executions = max(0, active_executions - 1)
    if execution_queue:
        _, future = execution_queue.pop(0)
        if not future.done():
            future.set_result(True)
    broadcast_sse("QUEUE_UPDATE", {"active": active_executions, "depth": len(execution_queue)})

# ----------------------------------------------------
# SSE clients queue registry & broadcast
# ----------------------------------------------------
sse_clients = []

def broadcast_sse(event_type: str, payload: dict):
    data = json.dumps({"type": event_type, "payload": payload})
    for queue in list(sse_clients):
        try:
            queue.put_nowait(data)
        except Exception:
            pass

@app.get("/api/harness/stream")
async def sse_stream(request: Request):
    async def event_generator():
        queue = asyncio.Queue()
        sse_clients.append(queue)
        
        # Initial sync states
        initial_sync = json.dumps({"type": "SYNC_STATE", "payload": STATE})
        yield f"data: {initial_sync}\n\n"
        
        # Initial queue sync
        queue_sync = json.dumps({"type": "QUEUE_UPDATE", "payload": {"active": active_executions, "depth": len(execution_queue)}})
        yield f"data: {queue_sync}\n\n"
        
        try:
            while True:
                if await request.is_disconnected():
                    break
                data = await queue.get()
                yield f"data: {data}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if queue in sse_clients:
                sse_clients.remove(queue)
                
    return StreamingResponse(event_generator(), media_type="text/event-stream")

# ----------------------------------------------------
# Long-polling approvals holding map
# ----------------------------------------------------
pending_approvals = {}

# ----------------------------------------------------
# REST API Gateway Routes
# ----------------------------------------------------

@app.get("/api/harness/state")
async def get_state():
    return STATE

@app.get("/api/harness/approvals")
async def get_approvals():
    return list(pending_approvals.keys())

@app.post("/api/harness/config")
async def post_config(request: Request):
    body = await request.json()
    if "agents" in body:
        STATE["agents"] = body["agents"]
    if "tools" in body:
        STATE["tools"] = body["tools"]
    if "flags" in body:
        STATE["flags"] = body["flags"]
    if "globalBudgetCap" in body:
        STATE["globalBudgetCap"] = body["globalBudgetCap"]
    if "globalMaxConcurrency" in body:
        STATE["globalMaxConcurrency"] = body["globalMaxConcurrency"]
    if "globalRateLimit" in body:
        STATE["globalRateLimit"] = body["globalRateLimit"]
    if "globalPromptVersion" in body:
        STATE["globalPromptVersion"] = body["globalPromptVersion"]
    if "verizonBudget" in body:
        STATE["verizonBudget"] = body["verizonBudget"]
    if "targetingRules" in body:
        STATE["targetingRules"] = body["targetingRules"]
    if "tierConfigs" in body:
        STATE["tierConfigs"] = body["tierConfigs"]
        
    broadcast_sse("SYNC_STATE", STATE)
    return {"success": True}

@app.post("/api/harness/reset-kill")
async def post_reset_kill():
    STATE["isKillSwitchActive"] = False
    STATE["isGlobalShutdown"] = False
    broadcast_sse("RESET_KILL", {})
    broadcast_sse("SYNC_STATE", STATE)
    return {"success": True}

@app.post("/api/harness/shutdown")
async def post_shutdown():
    STATE["isGlobalShutdown"] = True
    broadcast_sse("GLOBAL_SHUTDOWN", {})
    return {"success": True}

@app.post("/api/harness/approve")
async def post_approve(request: Request):
    body = await request.json()
    tx_id = body.get("txId")
    approved = body.get("approved")
    
    if tx_id in pending_approvals:
        fut = pending_approvals.pop(tx_id)
        if not fut.done():
            fut.set_result(approved)
        return {"success": True}
    else:
        return JSONResponse(status_code=404, content={"error": "Transaction ID not found or already processed"})

# ----------------------------------------------------
# PROXY GATEWAY ENDPOINT sits over workflows
# ----------------------------------------------------
@app.post("/api/agent/execute")
async def agent_execute(request: Request):
    req_id = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
    
    # 1. Active Concurrency Lock Manager
    await acquire_concurrency_slot(req_id)
    
    # Spans registry for tracing tree (LangSmith style)
    spans = []
    def create_span(name: str, parent_id: str = None) -> str:
        span_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
        spans.append({
            "id": span_id,
            "name": name,
            "parent_id": parent_id,
            "start_time": int(time.time() * 1000),
            "end_time": None,
            "status": "SUCCESS",
            "metadata": {}
        })
        return span_id

    def close_span(span_id: str, status: str = "SUCCESS", metadata: dict = None):
        for s in spans:
            if s["id"] == span_id:
                s["end_time"] = int(time.time() * 1000)
                s["status"] = status
                if metadata:
                    s["metadata"].update(metadata)
                break

    root_span = create_span("API Gateway proxy execution")
    
    try:
        body = await request.json()
        agent_id = body.get("agentId")
        prompt = body.get("prompt", "")
        tool_call = body.get("toolCall")
        client_context = body.get("context", {})
        
        # 2. Check general shutdown / kill switch active
        if STATE["isGlobalShutdown"] or STATE["isKillSwitchActive"]:
            close_span(root_span, "FAILED", {"error": "Control Plane Shutdown Override Active"})
            return JSONResponse(status_code=503, content={
                "error": "Control Plane Offline",
                "message": "Gateway proxy has suspended API connections. Fleet command shutdown is engaged.",
                "spans": spans
            })
            
        agent = STATE["agents"].get(agent_id)
        if not agent:
            close_span(root_span, "FAILED", {"error": f"Agent {agent_id} not in registry"})
            return JSONResponse(status_code=404, content={"error": f"Agent '{agent_id}' not found in registry.", "spans": spans})
            
        steps = []
        def log_step(source: str, msg: str, type_str: str = 'system'):
            step = {"text": msg, "type": type_str}
            steps.append(step)
            broadcast_sse('LOG_EVENT', {"source": source, "msg": msg, "type": type_str})
            
        log_step("Control Plane", f"REST Request captured on {STATE['globalPromptVersion']}. Agent: {agent['name']}", "system")
        
        # A. Guardrail Scan
        guardrail_span = create_span("Guardrail Scan", parent_id=root_span)
        if STATE["flags"]["guardrails"]:
            log_step("Guardrails", "Scanning prompt payload for security compliance...", "check")
            await asyncio.sleep(0.3)
            
            prompt_lower = prompt.lower()
            if "continuously poll" in prompt_lower or "infinite loop" in prompt_lower:
                log_step("Guardrails", "[GUARDRAILS INTERCEPT] Prompt query pattern matches blocked 'runaway query' signature.", "alert")
                log_step("Control Plane", "Gateway blocked execution to safeguard token burn. Status: 403 Forbidden.", "alert")
                
                broadcast_sse('NODE_ALERT', {"nodeId": agent_id, "type": "alert"})
                close_span(guardrail_span, "ALERT", {"error": "Safety block triggered on infinite loop prompt"})
                close_span(root_span, "FAILED", {"error": "Safety Intercept"})
                return JSONResponse(status_code=403, content={
                    "error": "Guardrail Denied",
                    "message": "Request blocked by safety policy. Runaway loop signature detected.",
                    "steps": steps,
                    "spans": spans
                })
            log_step("Guardrails", "Prompt payload passed safety compliance scan.", "success")
        close_span(guardrail_span, "SUCCESS")

        # Check if agent is the supervisor orchestrator (triggers multi-agent coordinated run)
        if agent_id == "supervisor-orchestrator":
            orchestration_span = create_span("Multi-Agent Hierarchical Orchestration", parent_id=root_span)
            
            # Step 1: Call Telemetry Fusion Agent
            log_step("Supervisor", "Dispatching sub-task: Telemetry log analysis -> Telemetry Fusion Agent", "system")
            telemetry_span = create_span("Telemetry Fusion Agent run", parent_id=orchestration_span)
            broadcast_sse('NODE_ACTIVE', {"nodeId": "supervisor-orchestrator"})
            await asyncio.sleep(0.3)
            broadcast_sse('PACKET_ANIM', {"from": "supervisor-orchestrator", "to": "telemetry-agent"})
            await asyncio.sleep(0.8)
            broadcast_sse('NODE_ACTIVE', {"nodeId": "telemetry-agent"})
            log_step("Telemetry Agent", "Analyzing alarm stream... 1,200 interface flapping logs correlated.", "success")
            close_span(telemetry_span, "SUCCESS")
            
            # Step 2: Call Knowledge AI Engine
            log_step("Supervisor", "Dispatching verification query: Cache search -> Knowledge AI Engine", "system")
            knowledge_span = create_span("Knowledge AI Engine lookup", parent_id=orchestration_span)
            broadcast_sse('PACKET_ANIM', {"from": "supervisor-orchestrator", "to": "knowledge-ai"})
            await asyncio.sleep(0.8)
            broadcast_sse('NODE_ACTIVE', {"nodeId": "knowledge-ai"})
            log_step("Knowledge AI", "Semantic index lookup completed. 0 matches found in historical cache.", "warn")
            close_span(knowledge_span, "SUCCESS")
            
            # Step 3: Call Delphi RCA Agent (HITL config write)
            log_step("Supervisor", "Dispatching mitigation action: BGP Config write -> Delphi RCA Agent", "system")
            delphi_span = create_span("Delphi RCA Agent mitigation run", parent_id=orchestration_span)
            broadcast_sse('PACKET_ANIM', {"from": "supervisor-orchestrator", "to": "delphi-rca"})
            await asyncio.sleep(0.8)
            broadcast_sse('NODE_ACTIVE', {"nodeId": "delphi-rca"})
            
            # Sub-span tool execution
            tool_span = create_span("Tool Execute: BGP Router Config write", parent_id=delphi_span)
            log_step("Delphi RCA", "Applying route filter loops on Northeast-core-01 BGP router...", "check")
            await asyncio.sleep(0.5)
            
            # Enforce HITL approval hold
            tx_id = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
            log_step("Control Plane", f"Tool 'BGP Router Config write' requires supervisor authorization. Pausing orchestrator thread. Transaction ID: {tx_id}...", "warn")
            broadcast_sse('PENDING_APPROVAL', {
                "txId": tx_id,
                "agentId": "delphi-rca",
                "agentName": "Delphi RCA Agent",
                "toolName": "BGP Router Config write",
                "action": "Apply route filter loops on Northeast-core-01",
                "cost": 0.05
            })
            
            hitl_span = create_span("Human-in-the-Loop approval hold", parent_id=tool_span)
            loop = asyncio.get_running_loop()
            fut = loop.create_future()
            pending_approvals[tx_id] = fut
            approved = await fut
            close_span(hitl_span, "SUCCESS" if approved else "FAILED", {"approved": approved, "tx_id": tx_id})
            
            if not approved:
                log_step("Control Plane", f"Supervisor REJECTED BGP write action for transaction {tx_id}. Orchestrator aborted.", "alert")
                close_span(tool_span, "FAILED", {"error": "HITL Denied"})
                close_span(delphi_span, "FAILED")
                close_span(orchestration_span, "FAILED")
                close_span(root_span, "FAILED")
                return JSONResponse(status_code=403, content={
                    "error": "Permission Denied",
                    "message": "Transaction rejected by supervisor.",
                    "steps": steps,
                    "spans": spans
                })
            
            log_step("Control Plane", f"Supervisor APPROVED transaction {tx_id}. Applying BGP filters...", "success")
            await asyncio.sleep(0.5)
            close_span(tool_span, "SUCCESS")
            close_span(delphi_span, "SUCCESS")
            
            # Step 4: Call SecOps Compliance Agent
            log_step("Supervisor", "Dispatching compliance review -> SecOps Compliance Agent", "system")
            compliance_span = create_span("SecOps Compliance Agent check", parent_id=orchestration_span)
            broadcast_sse('PACKET_ANIM', {"from": "supervisor-orchestrator", "to": "secops-compliance"})
            await asyncio.sleep(0.8)
            broadcast_sse('NODE_ACTIVE', {"nodeId": "secops-compliance"})
            log_step("SecOps Compliance", "Reviewing BGP routing changes. Compliance check: PASSED.", "success")
            close_span(compliance_span, "SUCCESS")
            
            # Step 5: Send alerts SMTP
            log_step("SecOps Compliance", "Dispatching automated alerts summary to network operations mail server.", "check")
            smtp_span = create_span("SMTP Alert dispatch", parent_id=compliance_span)
            await asyncio.sleep(0.3)
            log_step("Compliance", "Email notifications sent to ops-group@verizon.com.", "success")
            close_span(smtp_span, "SUCCESS")
            
            close_span(orchestration_span, "SUCCESS")
            
            # Consolidated Cost calculation
            orchestration_cost = 0.91
            
            # Update spends
            agent["currentSpend"] += orchestration_cost
            STATE["totalSpend"] += orchestration_cost
            STATE["buBudgets"][agent["bu"]]["spend"] += orchestration_cost
            broadcast_sse('SYNC_STATE', STATE)
            
            # Run output judges
            judges_span = create_span("Automated Output Evaluation Judges", parent_id=root_span)
            judges_grades = run_automated_judges(prompt, "Northeast Core Outage resolved successfully through multi-agent orchestration.", orchestration_cost)
            close_span(judges_span, "SUCCESS", {"grades": judges_grades})
            
            close_span(root_span, "SUCCESS")
            
            return {
                "source": "llm_generation",
                "model": "o1-pro (Orchestrated)",
                "tier": "Tier 3",
                "resolution": "Northeast Core Outage resolved successfully through multi-agent orchestration. Physical links correlated, BGP router config filters applied, and compliance notifications dispatched.",
                "cost": orchestration_cost,
                "outcome": "SUCCESSFUL_RESOLUTION",
                "steps": steps,
                "spans": spans,
                "judges": judges_grades
            }

        elif agent_id == "bizops-order":
            orchestration_span = create_span("Multi-Agent Ledger Reconciliation", parent_id=root_span)
            
            # Step 1: Call Billing Reconciliation Agent
            log_step("BizOps", "Dispatching sub-task: Sync active accounting ledgers -> Billing Reconciliation Agent", "system")
            billing_span = create_span("Billing Reconciliation Agent run", parent_id=orchestration_span)
            broadcast_sse('NODE_ACTIVE', {"nodeId": "bizops-order"})
            await asyncio.sleep(0.3)
            broadcast_sse('PACKET_ANIM', {"from": "bizops-order", "to": "billing-sync"})
            await asyncio.sleep(0.8)
            broadcast_sse('NODE_ACTIVE', {"nodeId": "billing-sync"})
            log_step("Billing Sync", "Scanning enterprise ledgers. Found 2 out-of-sync invoice records. Reconciled successfully.", "success")
            close_span(billing_span, "SUCCESS")
            
            # Step 2: Call Knowledge AI Engine
            log_step("BizOps", "Dispatching historical audit query -> Knowledge AI Engine", "system")
            knowledge_span = create_span("Knowledge AI Engine lookup", parent_id=orchestration_span)
            broadcast_sse('PACKET_ANIM', {"from": "bizops-order", "to": "knowledge-ai"})
            await asyncio.sleep(0.8)
            broadcast_sse('NODE_ACTIVE', {"nodeId": "knowledge-ai"})
            log_step("Knowledge AI", "Historical ledger discrepancy cache query returned 1 matching pattern.", "success")
            close_span(knowledge_span, "SUCCESS")
            
            # Step 3: Run Database query tool
            tool_span = create_span("Tool Execute: Database Query", parent_id=orchestration_span)
            log_step("BizOps", "Querying SQL configuration database for Order #VZW-F-99081 billing metadata...", "check")
            await asyncio.sleep(0.5)
            log_step("BizOps", "Database query success. Ledger metadata retrieved.", "success")
            close_span(tool_span, "SUCCESS")
            
            close_span(orchestration_span, "SUCCESS")
            
            # Cost calculation
            orchestration_cost = 0.01
            
            agent["currentSpend"] += orchestration_cost
            STATE["totalSpend"] += orchestration_cost
            STATE["buBudgets"][agent["bu"]]["spend"] += orchestration_cost
            broadcast_sse('SYNC_STATE', STATE)
            
            # Run output judges
            judges_span = create_span("Automated Output Evaluation Judges", parent_id=root_span)
            judges_grades = run_automated_judges(prompt, "Order ledger reconciliation complete. Active billing records verified and synchronized.", orchestration_cost)
            close_span(judges_span, "SUCCESS", {"grades": judges_grades})
            
            close_span(root_span, "SUCCESS")
            
            return {
                "source": "llm_generation",
                "model": "GPT-4o-mini (Orchestrated)",
                "tier": "Tier 1",
                "resolution": "Order ledger reconciliation complete. Active billing records verified and synchronized. Discrepancy isolated and fixed.",
                "cost": orchestration_cost,
                "outcome": "SUCCESSFUL_RESOLUTION",
                "steps": steps,
                "spans": spans,
                "judges": judges_grades
            }

        # B. Targeting Rules evaluation
        rules_span = create_span("Targeting Rules evaluation", parent_id=root_span)
        
        # Infer contexts from prompt if not explicitly provided
        inferred_context = dict(client_context)
        if not inferred_context:
            if "northeast" in prompt.lower():
                inferred_context["region"] = "northeast-edge"
            if agent_id == "delphi-rca":
                inferred_context["userRole"] = "contractor"
                
        active_model = agent["model"]
        active_tier = agent.get("routingTier", "Tier 3")
        force_approval_override = False
        
        for rule in STATE["targetingRules"]:
            attr = rule["attribute"]
            val_to_check = inferred_context.get(attr, "")
            operator = rule["operator"]
            target_val = rule["value"]
            
            matched = False
            if operator == "equals" and str(val_to_check).lower() == str(target_val).lower():
                matched = True
            elif operator == "contains" and str(target_val).lower() in str(val_to_check).lower():
                matched = True
                
            if matched:
                log_step("Targeting Rules", f"[RULE MATCHED] Rule '{rule['id']}' matched on context '{attr}={val_to_check}'. Action: {rule['action']}={rule['actionValue']}", "route")
                if rule["action"] == "route_override":
                    active_model = rule["actionValue"]
                elif rule["action"] == "force_hitl":
                    force_approval_override = (rule["actionValue"].lower() == "true")
                elif rule["action"] == "route_tier":
                    active_tier = rule["actionValue"]
                    
        close_span(rules_span, "SUCCESS", {
            "context_matched": inferred_context, 
            "active_model": active_model, 
            "force_hitl": force_approval_override,
            "active_tier": active_tier
        })

        # C. Budget Check
        log_step("Compliance", f"Checking Agent budget... Limit: ${agent['budget']:.2f} | Current: ${agent['currentSpend']:.2f}", "check")
        if agent["currentSpend"] >= agent["budget"]:
            log_step("Control Plane", f"Payment Required: Agent '{agent['name']}' budget limit breached. Status: 402.", "alert")
            close_span(root_span, "FAILED", {"error": "Budget Breached"})
            return JSONResponse(status_code=402, content={
                "error": "Budget Breached",
                "message": f"Agent {agent['name']} has exhausted its budget allocation.",
                "steps": steps,
                "spans": spans
            })
            
        # D. Cache check (Continuous Learning)
        cache_span = create_span("Semantic Cache lookup", parent_id=root_span)
        delphi_to_knowledge = any(
            (l["from"] == 'delphi-rca' and l["to"] == 'knowledge-ai') or (l["from"] == 'knowledge-ai' and l["to"] == 'delphi-rca')
            for l in STATE["topology"]["links"]
        )
        is_knowledge_linked = (agent_id == 'delphi-rca' and delphi_to_knowledge) or agent_id == 'bizops-order'
        
        cache_match_index = -1
        for idx, cache_item in enumerate(STATE["knowledgeCache"]):
            if prompt.lower() in cache_item["query"].lower() or cache_item["query"].lower() in prompt.lower():
                cache_match_index = idx
                break
                
        if is_knowledge_linked and cache_match_index != -1:
            cache_item = STATE["knowledgeCache"][cache_match_index]
            log_step("Knowledge AI", f"[CACHE HIT] Matched signature: \"{cache_item['query']}\". Bypassing LLM generation.", "route")
            
            # Animate packet topology
            broadcast_sse('NODE_ACTIVE', {"nodeId": agent_id})
            await asyncio.sleep(0.2)
            broadcast_sse('PACKET_ANIM', {"from": agent_id, "to": "knowledge-ai"})
            await asyncio.sleep(0.8)
            broadcast_sse('NODE_ACTIVE', {"nodeId": "knowledge-ai"})
            
            log_step("Execution", f"Tier 0 Retrieval: Fetching resolution key: \"{cache_item['resolution']}\"", "success")
            log_step("FinOps", f"Saved Tier 3 Call. Savings: ${cache_item['savings']:.2f}. Token Cost: $0.00", "success")
            
            STATE["totalSaved"] += cache_item["savings"]
            broadcast_sse('SYNC_STATE', STATE)
            
            close_span(cache_span, "SUCCESS", {"query": prompt, "cache_hit": True})
            close_span(root_span, "SUCCESS")
            
            # Run output evaluations
            judges_grades = run_automated_judges(prompt, cache_item["resolution"], 0.00)
            
            return {
                "source": "cache_retrieval",
                "tier": "Tier 0",
                "resolution": cache_item["resolution"],
                "cost": 0.00,
                "saved": cache_item["savings"],
                "steps": steps,
                "spans": spans,
                "judges": judges_grades
            }
        close_span(cache_span, "SUCCESS", {"cache_hit": False})

        # E. Injected Error & Self-Healing Fallback
        if STATE["flags"]["injectError"] and (agent_id == 'telemetry-agent' or agent_id == 'bizops-order'):
            log_step("Execution", "[SIMULATED FAIL] Injected error: Sub-tier AI provider returned HTTP 503 Service Unavailable.", "alert")
            await asyncio.sleep(0.5)
            
            if STATE["flags"]["fallback"]:
                log_step("Self-Healing", "[SELF-HEALING] Intercepted sub-tier model downtime. Initiating automated recovery loop...", "warn")
                log_step("Self-Healing", "Re-routing execution target path from Tier 1 to Tier 3 Frontier Reasoning LLM...", "route")
                await asyncio.sleep(0.6)
                
                broadcast_sse('NODE_ACTIVE', {"nodeId": agent_id, "class": "reasoning"})
                log_step("Execution", "Frontier LLM: Processing telemetry logs with complex fallback parser. Config isolated.", "success")
                
                total_cost = TIER_COSTS["tier3"]
                agent["currentSpend"] += total_cost
                STATE["totalSpend"] += total_cost
                STATE["buBudgets"][agent["bu"]]["spend"] += total_cost
                
                broadcast_sse('SYNC_STATE', STATE)
                close_span(root_span, "SUCCESS", {"fallback_triggered": True})
                
                judges_grades = run_automated_judges(prompt, "Telemetry anomalies clustered via fallback.", total_cost)
                
                return {
                    "source": "self_healed_fallback",
                    "model": "o1-pro (Frontier)",
                    "tier": "Tier 3 (Fallback)",
                    "resolution": "Telemetry anomalies successfully clustered via fallback parser.",
                    "cost": total_cost,
                    "steps": steps,
                    "spans": spans,
                    "judges": judges_grades
                }
            else:
                log_step("Self-Healing", "[CRITICAL FAULT] Sub-tier model failed. No fallback route configured. Aborting execution loop.", "alert")
                close_span(root_span, "FAILED", {"error": "Model Downtime"})
                return JSONResponse(status_code=502, content={
                    "error": "Bad Gateway",
                    "message": "Injected model failure. No fallback configured.",
                    "steps": steps,
                    "spans": spans
                })

        # F. Active Execution Loop (LLM call + Tool usage)
        llm_span = create_span(f"LLM Generation ({active_model})", parent_id=root_span)
        tier_key = active_tier.lower().replace(" ", "")
        run_cost = TIER_COSTS.get(tier_key, 0.40)
        log_step("Execution", f"Resolved routing target: {active_tier} (Model: {active_model} | Base Cost: ${run_cost:.4f})", "route")
        
        if tool_call:
            tool_name = tool_call.get("name")
            tool = STATE["tools"].get(tool_name)
            if not tool:
                close_span(llm_span, "FAILED", {"error": "Tool not found"})
                close_span(root_span, "FAILED")
                return JSONResponse(status_code=404, content={"error": f"Tool {tool_name} not found", "steps": steps, "spans": spans})
                
            # Check permissions
            if tool_name not in agent["authorizedTools"]:
                log_step("Compliance", f"[POLICY BREACH] Blocked tool execution: Agent '{agent['name']}' is not authorized to execute '{tool['name']}'.", "alert")
                broadcast_sse('NODE_ALERT', {"nodeId": agent_id, "type": "alert"})
                close_span(llm_span, "FAILED", {"error": "Tool unauthorized"})
                close_span(root_span, "FAILED")
                return JSONResponse(status_code=403, content={"error": "Policy Blocked", "message": f"Tool {tool['name']} is not authorized for this agent.", "steps": steps, "spans": spans})
                
            run_cost += tool["cost"]
            
            tool_span = create_span(f"Tool Execute: {tool['name']}", parent_id=llm_span)
            
            # Check Human-In-The-Loop triggers (or Rule overrides)
            requires_hitl = tool["requiresApproval"] or force_approval_override
            
            if requires_hitl:
                tx_id = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
                log_step("Control Plane", f"Tool '{tool['name']}' requires supervisor authorization. Pausing HTTP request thread. Transaction ID: {tx_id}...", "warn")
                
                broadcast_sse('PENDING_APPROVAL', {
                    "txId": tx_id,
                    "agentId": agent_id,
                    "agentName": agent["name"],
                    "toolName": tool["name"],
                    "action": tool_call["action"],
                    "cost": tool["cost"]
                })
                
                hitl_span = create_span("Human-in-the-Loop approval hold", parent_id=tool_span)
                
                # Await future
                loop = asyncio.get_running_loop()
                fut = loop.create_future()
                pending_approvals[tx_id] = fut
                
                approved = await fut
                close_span(hitl_span, "SUCCESS" if approved else "FAILED", {"approved": approved, "tx_id": tx_id})
                
                if not approved:
                    log_step("Control Plane", f"Supervisor REJECTED action for transaction {tx_id}. Discarding write command.", "alert")
                    broadcast_sse('NODE_ALERT', {"nodeId": agent_id, "type": "alert"})
                    close_span(tool_span, "FAILED", {"error": "HITL Denied"})
                    close_span(llm_span, "FAILED")
                    close_span(root_span, "FAILED")
                    return JSONResponse(status_code=403, content={
                        "error": "Permission Denied",
                        "message": "Transaction rejected by human supervisor.",
                        "steps": steps,
                        "spans": spans
                    })
                log_step("Control Plane", f"Supervisor APPROVED action for transaction {tx_id}. Executing tool write...", "success")
                await asyncio.sleep(0.5)
                
            close_span(tool_span, "SUCCESS")
        close_span(llm_span, "SUCCESS")

        # Finish run successfully
        outcome = "SUCCESSFUL_RESOLUTION"
        log_step("Execution", "Frontier LLM: Execution path completed successfully.", "success")
        
        # Cache resolution if Delphi RCA
        resolution_text = "Incident successfully resolved. Policy updates applied."
        if agent_id == 'delphi-rca':
            STATE["knowledgeCache"].insert(0, {
                "query": prompt,
                "resolution": "BGP route loop filter applied automatically on Northeast-core-01, packet loss mitigated.",
                "savings": TIER_COSTS["tier3"] - TIER_COSTS["tier0"]
            })
            resolution_text = "BGP route loop filter applied automatically on Northeast-core-01, packet loss mitigated."
            
        agent["currentSpend"] += run_cost
        STATE["totalSpend"] += run_cost
        STATE["buBudgets"][agent["bu"]]["spend"] += run_cost
        
        broadcast_sse('SYNC_STATE', STATE)
        
        # Run output judges
        judges_span = create_span("Automated Output Evaluation Judges", parent_id=root_span)
        judges_grades = run_automated_judges(prompt, resolution_text, run_cost)
        close_span(judges_span, "SUCCESS", {"grades": judges_grades})
        
        close_span(root_span, "SUCCESS")
        
        return {
            "source": "llm_generation",
            "model": active_model,
            "tier": active_tier,
            "resolution": resolution_text,
            "cost": run_cost,
            "outcome": outcome,
            "steps": steps,
            "spans": spans,
            "judges": judges_grades
        }
    except Exception as e:
        close_span(root_span, "FAILED", {"error": str(e)})
        raise e
    finally:
        # 3. Release Concurrency Depth Slot
        release_concurrency_slot()

# Helper output judges evaluator
def run_automated_judges(prompt: str, resolution: str, cost: float):
    safety = 100
    if "bgp" in prompt.lower() or "router" in prompt.lower():
        safety = 98
    if "leak" in resolution.lower() or "bypass" in prompt.lower():
        safety = 68
        
    syntax_compliance = 100
    if len(resolution) > 80:
        syntax_compliance = 97
        
    cost_score = max(0, min(100, int((1.0 - (cost / 0.50)) * 100)))
    
    return {
        "safety": safety,
        "format": syntax_compliance,
        "cost": cost_score
    }

# Serving index.html on root
app.mount("/", StaticFiles(directory=".", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 5174))
    uvicorn.run("server:app", host="0.0.0.0", port=port, log_level="info")
