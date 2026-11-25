import type { Response } from "express";
import { withAgeFields, type AgeBand, type AgePreference } from "./age-band";
import { supabaseJson, supabaseServiceJson } from "./supabase";
import type { Session } from "./session";

export type ProfileRow = {
  id: string;
  display_name: string;
  birth_year: number | null;
  age_preference?: AgePreference;
  age_band: AgeBand | null;
  birth_year_locked: boolean;
  gender: string | null;
  profile_photo_url: string;
  sports: string[];
  interests: string[];
  bio: string | null;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
};

export type GymRow = {
  id: string;
  name: string;
  description: string | null;
  address: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  image_url: string | null;
  created_at: string;
};

export type ClassRow = {
  id: string;
  gym_id: string;
  title: string;
  sport_type: string;
  description: string | null;
  scheduled_at: string;
  duration_minutes: number;
  capacity: number;
  price: number;
  image_url: string | null;
  age_band?: string | null;
  status: string;
  created_at: string;
  gyms?: GymRow | GymRow[];
};

export type ParticipantRow = {
  id: string;
  class_id: string;
  user_id: string;
  payment_status: string;
  attendance_status: string;
  joined_at: string;
  profiles?: Pick<ProfileRow, "display_name" | "profile_photo_url"> | null;
};

export async function getProfile(
  userId: string,
  accessToken?: string,
): Promise<ProfileRow | null> {
  const rows = await supabaseJson<ProfileRow[]>(
    `/rest/v1/profiles?select=*&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: "GET" },
    accessToken,
  );
  return rows[0] ? withAgeFields(rows[0]) : null;
}

export async function requireAdmin(
  session: Session,
  response: Response,
): Promise<ProfileRow | null> {
  const profile = await getProfile(session.user.id, session.accessToken);
  if (!profile?.is_admin) {
    response.status(403).json({ error: "관리자 권한이 필요합니다." });
    return null;
  }
  return profile;
}

export async function getClassRow(
  classId: string,
  accessToken?: string,
): Promise<ClassRow | null> {
  const rows = await supabaseJson<ClassRow[]>(
    `/rest/v1/classes?select=*,gyms(*)&id=eq.${encodeURIComponent(classId)}&limit=1`,
    { method: "GET" },
    accessToken,
  );
  return rows[0] ?? null;
}

export async function getParticipantRows(
  classId: string,
  accessToken?: string,
): Promise<ParticipantRow[]> {
  const rows = await supabaseJson<Omit<ParticipantRow, "profiles">[]>(
    `/rest/v1/class_participants?select=*&class_id=eq.${encodeURIComponent(classId)}&order=joined_at.asc`,
    { method: "GET" },
    accessToken,
  );
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  if (!userIds.length) return rows.map((row) => ({ ...row, profiles: null }));

  const profiles = await supabaseJson<
    Array<Pick<ProfileRow, "id" | "display_name" | "profile_photo_url">>
  >(
    `/rest/v1/profiles?select=id,display_name,profile_photo_url&id=in.(${encodeURIComponent(userIds.join(","))})`,
    { method: "GET" },
    accessToken,
  );
  const profileByUserId = new Map(profiles.map((profile) => [profile.id, profile]));
  return rows.map((row) => ({
    ...row,
    profiles: profileByUserId.get(row.user_id) ?? null,
  }));
}

export function toGym(row: GymRow | undefined): GymRow | null {
  if (!row) return null;
  return row;
}

export function toClassDetail(
  row: ClassRow,
  participantCount: number,
  isJoined: boolean,
) {
  const gym = Array.isArray(row.gyms) ? row.gyms[0] : row.gyms;
  return {
    ...row,
    gym: gym ?? null,
    participant_count: participantCount,
    remaining_slots: Math.max(row.capacity - participantCount, 0),
    is_joined: isJoined,
  };
}

type SeatCount = {
  class_id: string;
  occupied: number;
  is_joined: boolean;
};

export async function getClassDetails(
  rows: ClassRow[],
  session: Session | null,
): Promise<ReturnType<typeof toClassDetail>[]> {
  if (!rows.length) return [];
  // Registered and attended hold a seat. The snapshot is security definer and
  // is called with the service role, so the caller's RLS cannot hide other
  // members or keep counting a cancelled row.
  const snapshots = await supabaseServiceJson<SeatCount[]>(
    "/rest/v1/rpc/class_seat_counts",
    {
      method: "POST",
      body: JSON.stringify({
        p_class_ids: rows.map((row) => row.id),
        p_user_id: session?.user.id ?? null,
      }),
    },
  );
  const byClassId = new Map((Array.isArray(snapshots) ? snapshots : []).map((row) => [row.class_id, row]));
  return rows.map((row) => {
    const seat = byClassId.get(row.id);
    return toClassDetail(row, seat?.occupied ?? 0, Boolean(seat?.is_joined));
  });
}