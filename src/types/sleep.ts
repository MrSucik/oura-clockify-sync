// Note: Properties use snake_case to match Oura API response format
export interface SleepSession {
  day: string;
  bedtime_start: string;
  bedtime_end: string;
  total_sleep_duration: number;
  efficiency: number;
  score?: number;
  rem_sleep_duration: number;
  deep_sleep_duration: number;
  light_sleep_duration: number;
  awake_time: number;
}

export interface SleepDataResponse {
  data: SleepSession[];
}
