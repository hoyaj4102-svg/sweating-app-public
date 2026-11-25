import type { MatchSummary, PublicParticipantProfile } from "@workspace/api-zod";
import { displayProfilePhoto } from "./profile-photo-storage";
import { supabaseServiceJson } from "./supabase";
import type { ClassRow } from "./data";
import {
  isClassRevealOpen,
  REVEAL_ATTENDANCE_MESSAGE,
  REVEAL_OPEN_MESSAGE,
  REVEAL_WAITING_MESSAGE,
  REVEALED_ATTENDANCE_STATUS,
} from "./reveal";

type ParticipantProfileRow = {
  id: string;
  user_id: string;
  class_id: string;
  joined_at: string;
  attendance_status: string;
  profiles:
    | {
        display_name: string;
        profile_photo_url: string;
        sports: string[];
        interests: string[];
        bio: string | null;
      }
    | Array<{
        display_name: string;
        profile_photo_url: string;
        sports: string[];
        interests: string[];
        bio: string | null;
      }>
    | null;
};

type ServiceProfileRow = {
  id: string;
  display_name: string;
  profile_photo_url: string;
  sports: string[];
  interests: string[];
  bio: string | null;
};

type LikeRow = {
  from_user_id: string;
  to_user_id: string;
};

type MatchRow = {
  id: string;
  class_id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: string;
};

function profileFromRow(row: ParticipantProfileRow) {
  return Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
}

function toPublicProfile(
  row: ParticipantProfileRow,
  likedUserIds: Set<string>,
  matchedUserIds: Set<string>,
): PublicParticipantProfile {
  const profile = profileFromRow(row);
  return {
    participant_id: row.id,
    display_name: profile?.display_name ?? "SWEATIN’ 참가자",
    profile_photo_url: profile?.profile_photo_url ?? "",
    sports: profile?.sports ?? [],
    interests: profile?.interests ?? [],
    bio: profile?.bio ?? null,
    is_liked: likedUserIds.has(row.user_id),
    is_matched: matchedUserIds.has(row.user_id),
  };
}

async function getServiceClass(classId: string): Promise<ClassRow | null> {
  const rows = await supabaseServiceJson<ClassRow[]>(
    `/rest/v1/classes?select=*,gyms(*)&id=eq.${encodeURIComponent(classId)}&limit=1`,
  );
  return rows[0] ?? null;
}

async function getServiceParticipants(classId: string): Promise<ParticipantProfileRow[]> {
  const rows = await supabaseServiceJson<
    Omit<ParticipantProfileRow, "profiles">[]
  >(
    `/rest/v1/class_participants?select=id,user_id,class_id,joined_at,attendance_status&class_id=eq.${encodeURIComponent(classId)}&attendance_status=neq.cancelled&order=joined_at.asc`,
  );
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  if (!userIds.length) return rows.map((row) => ({ ...row, profiles: null }));

  const profiles = await supabaseServiceJson<ServiceProfileRow[]>(
    `/rest/v1/profiles?select=id,display_name,profile_photo_url,sports,interests,bio&id=in.(${encodeURIComponent(userIds.join(","))})`,
  );
  const profileByUserId = new Map(profiles.map((profile) => [profile.id, profile]));
  return rows.map((row) => ({
    ...row,
    profiles: profileByUserId.get(row.user_id) ?? null,
  }));
}

async function getServiceMatchesForClass(classId: string): Promise<MatchRow[]> {
  return supabaseServiceJson<MatchRow[]>(
    `/rest/v1/matches?select=id,class_id,user_a_id,user_b_id,created_at&class_id=eq.${encodeURIComponent(classId)}`,
  );
}

function toClassDetailFromParticipants(
  row: ClassRow,
  participants: ParticipantProfileRow[],
  isJoined: boolean,
) {
  const gym = Array.isArray(row.gyms) ? row.gyms[0] : row.gyms;
  return {
    ...row,
    gym: gym ?? null,
    participant_count: participants.length,
    remaining_slots: Math.max(row.capacity - participants.length, 0),
    is_joined: isJoined,
  };
}

export async function getRevealedParticipants(
  classId: string,
  currentUserId: string,
): Promise<{
  class: ReturnType<typeof toClassDetailFromParticipants>;
  is_revealed: boolean;
  message: string;
  participants: PublicParticipantProfile[];
}> {
  const [row, participants] = await Promise.all([
    getServiceClass(classId),
    getServiceParticipants(classId),
  ]);

  if (!row) {
    throw Object.assign(new Error("class_not_found"), { status: 404 });
  }

  const isParticipant = participants.some((participant) => participant.user_id === currentUserId);
  if (!isParticipant) {
    throw Object.assign(new Error("participants_only"), { status: 403 });
  }

  const classDetails = toClassDetailFromParticipants(row, participants, true);
  const caller = participants.find((participant) => participant.user_id === currentUserId);
  // Status alone is not enough: an early complete must wait for scheduled_at + duration.
  // Registered and no_show rows are never returned, and those callers do not receive profiles.
  if (!isClassRevealOpen(row)) {
    return {
      class: classDetails,
      is_revealed: false,
      message: REVEAL_WAITING_MESSAGE,
      participants: [],
    };
  }
  if (caller?.attendance_status !== REVEALED_ATTENDANCE_STATUS) {
    return {
      class: classDetails,
      is_revealed: false,
      message: REVEAL_ATTENDANCE_MESSAGE,
      participants: [],
    };
  }

  const [likes, matches] = await Promise.all([
    supabaseServiceJson<LikeRow[]>(
      `/rest/v1/likes?select=from_user_id,to_user_id&class_id=eq.${encodeURIComponent(classId)}&from_user_id=eq.${encodeURIComponent(currentUserId)}`,
    ),
    getServiceMatchesForClass(classId),
  ]);
  const likedUserIds = new Set(likes.map((like) => like.to_user_id));
  const matchedUserIds = new Set(
    matches
      .filter((match) => match.user_a_id === currentUserId || match.user_b_id === currentUserId)
      .map((match) => (match.user_a_id === currentUserId ? match.user_b_id : match.user_a_id)),
  );

  return {
    class: classDetails,
    is_revealed: true,
    message: REVEAL_OPEN_MESSAGE,
    participants: await Promise.all(participants
      .filter((participant) => {
        if (participant.user_id === currentUserId) return false;
        return participant.attendance_status === REVEALED_ATTENDANCE_STATUS;
      })
      .map(async (participant) => {
        const profile = toPublicProfile(participant, likedUserIds, matchedUserIds);
        return {
          ...profile,
          profile_photo_url: await displayProfilePhoto(profile.profile_photo_url, participant.user_id),
        };
      }),
    ),
  };
}

async function getMatchRowsForUser(userId: string): Promise<MatchRow[]> {
  const [asA, asB] = await Promise.all([
    supabaseServiceJson<MatchRow[]>(
      `/rest/v1/matches?select=id,class_id,user_a_id,user_b_id,created_at&user_a_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`,
    ),
    supabaseServiceJson<MatchRow[]>(
      `/rest/v1/matches?select=id,class_id,user_a_id,user_b_id,created_at&user_b_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`,
    ),
  ]);
  return [...asA, ...asB].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function getParticipantByUser(
  classId: string,
  userId: string,
): Promise<ParticipantProfileRow | null> {
  const rows = await supabaseServiceJson<Omit<ParticipantProfileRow, "profiles">[]>(
    `/rest/v1/class_participants?select=id,user_id,class_id,joined_at,attendance_status&class_id=eq.${encodeURIComponent(classId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  const row = rows[0];
  if (!row) return null;
  const profiles = await supabaseServiceJson<ServiceProfileRow[]>(
    `/rest/v1/profiles?select=id,display_name,profile_photo_url,sports,interests,bio&id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  return { ...row, profiles: profiles[0] ?? null };
}

async function matchStoragePhotoVisible(
  classRow: ClassRow,
  viewerId: string,
  participant: ParticipantProfileRow,
): Promise<boolean> {
  if (!isClassRevealOpen(classRow)) return false;
  if (participant.attendance_status !== REVEALED_ATTENDANCE_STATUS) return false;
  const viewer = await getParticipantByUser(classRow.id, viewerId);
  return viewer?.attendance_status === REVEALED_ATTENDANCE_STATUS;
}

async function toMatchSummary(
  match: MatchRow,
  currentUserId: string,
): Promise<MatchSummary | null> {
  const counterpartId =
    match.user_a_id === currentUserId ? match.user_b_id : match.user_a_id;
  const [row, participant] = await Promise.all([
    getServiceClass(match.class_id),
    getParticipantByUser(match.class_id, counterpartId),
  ]);
  if (!row || !participant) return null;

  const profile = toPublicProfile(participant, new Set([counterpartId]), new Set([counterpartId]));
  const raw = profile.profile_photo_url;
  // A match row is not enough. Storage paths and older http(s) photos both
  // stay hidden until the class has ended and both people attended.
  // Age preference and the 20-45 recruiting band do not hide a match photo.
  // The service role signs only after that gate.
  profile.profile_photo_url = await matchStoragePhotoVisible(row, currentUserId, participant)
    ? await displayProfilePhoto(raw, counterpartId)
    : "";
  return {
    id: match.id,
    class_id: match.class_id,
    class_title: row.title,
    sport_type: row.sport_type,
    scheduled_at: new Date(row.scheduled_at),
    gym_name: (Array.isArray(row.gyms) ? row.gyms[0] : row.gyms)?.name ?? "",
    participant: profile,
  };
}

export async function listMatchesForUser(userId: string): Promise<MatchSummary[]> {
  const matches = await getMatchRowsForUser(userId);
  const summaries = await Promise.all(matches.map((match) => toMatchSummary(match, userId)));
  return summaries.filter((summary): summary is MatchSummary => Boolean(summary));
}

export async function getMatchForUser(
  matchId: string,
  userId: string,
): Promise<MatchSummary | null> {
  const rows = await supabaseServiceJson<MatchRow[]>(
    `/rest/v1/matches?select=id,class_id,user_a_id,user_b_id,created_at&id=eq.${encodeURIComponent(matchId)}&limit=1`,
  );
  const match = rows[0];
  if (!match) return null;
  if (match.user_a_id !== userId && match.user_b_id !== userId) {
    throw Object.assign(new Error("match_forbidden"), { status: 403 });
  }
  return toMatchSummary(match, userId);
}