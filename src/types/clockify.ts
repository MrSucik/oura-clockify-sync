export interface ClockifyWorkspace {
  id: string;
  name: string;
}

export interface ClockifyUser {
  id: string;
  email: string;
  name: string;
}

export interface ClockifyProject {
  id: string;
  name: string;
  workspaceId: string;
  archived: boolean;
}

export interface ClockifyTimeEntry {
  id: string;
  description: string;
  start: string;
  end: string;
  duration: string;
  projectId?: string;
}

export interface CreateTimeEntryRequest {
  start: string;
  end: string;
  billable: boolean;
  description: string;
  projectId?: string;
  taskId?: string;
  tagIds?: string[];
}
