import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const DATA_DIR = path.resolve(process.cwd(), "data");

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface MissionEntry {
  id: string;
  projectId: string;
  status: string;
  startedAt: string;
  stoppedAt: string | null;
  completedAt: string | null;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  skippedTasks: number;
  taskHistory: Array<{
    taskId: string;
    taskTitle: string;
    agentId: string;
    status: string;
    summary: string;
    attempt: number;
  }>;
  loopDetection: { taskAttempts: Record<string, number>; taskErrors: Record<string, string[]> };
}

interface RunEntry {
  id: string;
  taskId: string;
  missionId: string | null;
  pid: number;
  status: string;
}

interface TaskEntry {
  id: string;
  kanban: string;
  assignedTo: string | null;
  projectId: string | null;
  blockedBy?: string[];
  deletedAt?: string | null;
}

interface DecisionEntry {
  taskId: string | null;
  status: string;
}

function readJSON<T>(filename: string): T | null {
  try {
    const filePath = path.join(DATA_DIR, filename);
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── Reconciliation ──────────────────────────────────────────────────────────

/**
 * Detect and fix stuck "running" missions — those that have no active processes
 * but haven't been marked as completed or stalled. This acts as a safety net
 * for when chain dispatch fails silently.
 */
function reconcileStuckMissions(missions: MissionEntry[]): boolean {
  let changed = false;

  const runsData = readJSON<{ runs: RunEntry[] }>("active-runs.json");
  const tasksData = readJSON<{ tasks: TaskEntry[] }>("tasks.json");
  const decisionsData = readJSON<{ decisions: DecisionEntry[] }>("decisions.json");
  if (!tasksData) return false;

  const allRuns = runsData?.runs ?? [];
  const pendingDecisionTaskIds = new Set(
    (decisionsData?.decisions ?? [])
      .filter((d) => d.status === "pending" && d.taskId)
      .map((d) => d.taskId as string)
  );

  for (const mission of missions) {
    if (mission.status !== "running") continue;

    // Check if any processes are actually alive for this mission
    const missionRuns = allRuns.filter(
      (r) => r.missionId === mission.id && r.status === "running"
    );
    const hasLiveProcesses = missionRuns.some((r) => isProcessAlive(r.pid));

    if (hasLiveProcesses) continue; // Mission is legitimately running

    // No live processes — check project tasks to determine correct state
    const projectTasks = tasksData.tasks.filter((t) => t.projectId === mission.projectId);
    const remaining = projectTasks.filter(
      (t) => t.kanban !== "done" && t.assignedTo && t.assignedTo !== "me" && !t.deletedAt
    );

    if (remaining.length === 0) {
      // All tasks done — mission should be completed
      mission.status = "completed";
      mission.completedAt = new Date().toISOString();
      mission.completedTasks = projectTasks.filter((t) => t.kanban === "done").length;
      changed = true;
      postMissionInboxReport(mission);
      continue;
    }

    // Check if any remaining tasks are dispatchable
    const dispatchable = remaining.filter((t) => {
      if (t.blockedBy && t.blockedBy.length > 0) {
        const allDone = t.blockedBy.every((depId) => {
          const dep = tasksData.tasks.find((d) => d.id === depId);
          return dep?.kanban === "done";
        });
        if (!allDone) return false;
      }
      if (pendingDecisionTaskIds.has(t.id)) return false;
      const attempts = mission.loopDetection.taskAttempts[t.id] ?? 0;
      if (attempts >= 3) return false;
      return true;
    });

    if (dispatchable.length === 0) {
      // Nothing dispatchable — mark as stalled
      mission.status = "stalled";
      mission.skippedTasks = remaining.length;
      changed = true;
      postMissionInboxReport(mission);
    } else {
      // Tasks are dispatchable but no processes running — mark as stalled
      // (The UI or user can restart the mission to re-dispatch)
      mission.status = "stalled";
      mission.skippedTasks = remaining.length - dispatchable.length;
      changed = true;
      postMissionInboxReport(mission);
    }
  }

  return changed;
}

/**
 * Post a mission report to inbox during reconciliation.
 */
function postMissionInboxReport(mission: MissionEntry): void {
  try {
    const inboxPath = path.join(DATA_DIR, "inbox.json");
    const inboxRaw = existsSync(inboxPath)
      ? readFileSync(inboxPath, "utf-8")
      : '{"messages":[]}';
    const inboxData = JSON.parse(inboxRaw) as { messages: Array<Record<string, unknown>> };

    const isComplete = mission.status === "completed";
    const remaining = mission.totalTasks - mission.completedTasks - mission.failedTasks;
    const subject = isComplete
      ? `Mission complete: ${mission.completedTasks}/${mission.totalTasks} tasks done`
      : `Mission stalled: ${mission.completedTasks}/${mission.totalTasks} tasks done, ${remaining} remaining`;

    const lines: string[] = [];
    if (isComplete) {
      lines.push(`All ${mission.completedTasks} tasks in this mission have been completed.`);
    } else {
      lines.push(`The mission has stalled with ${remaining} task(s) remaining that could not be dispatched.`);
    }

    if (mission.failedTasks > 0) {
      lines.push(`\n${mission.failedTasks} task(s) failed during execution.`);
    }

    // List completed tasks with file locations
    const completed = mission.taskHistory.filter((e) => e.status === "completed");
    if (completed.length > 0) {
      lines.push("\n**Completed tasks:**");
      for (const entry of completed) {
        lines.push(`- ${entry.taskTitle} (${entry.agentId})`);
        const filePaths = entry.summary.match(/(?:research|projects|docs|output)\/[\w\-/.]+\.\w+/g);
        if (filePaths) {
          for (const fp of [...new Set(filePaths)].slice(0, 3)) {
            lines.push(`  → ${fp}`);
          }
        }
      }
    }

    if (!isComplete) {
      lines.push("\nPlease check the Status Board for any remaining tasks. Some may need your input on the Decisions page.");
    }

    inboxData.messages.push({
      id: `msg_${Date.now()}`,
      from: "system",
      to: "me",
      type: "report",
      taskId: null,
      subject,
      body: lines.join("\n"),
      status: "unread",
      createdAt: new Date().toISOString(),
      readAt: null,
    });

    writeFileSync(inboxPath, JSON.stringify(inboxData, null, 2), "utf-8");
  } catch {
    // Best-effort — don't fail the API call
  }
}

// ─── GET: Return missions data (with reconciliation) ─────────────────────────

export async function GET() {
  try {
    const missionsPath = path.join(DATA_DIR, "missions.json");
    if (!existsSync(missionsPath)) {
      return NextResponse.json({ missions: [] });
    }
    const data = JSON.parse(readFileSync(missionsPath, "utf-8")) as { missions: MissionEntry[] };

    // Reconcile stuck missions on every poll (cheap — only checks when status is "running")
    const changed = reconcileStuckMissions(data.missions);
    if (changed) {
      writeFileSync(missionsPath, JSON.stringify(data, null, 2), "utf-8");
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ missions: [] });
  }
}
