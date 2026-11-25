import {
  CompleteClassParams,
  CreateClassBody,
  CreateGymBody,
  ListClassParticipantsParams,
  UpdateClassParams,
  UpdateGymParams,
} from "@workspace/api-zod";
import { isAgeBand, type AgeBand } from "./age-band";

export const ADMIN_CLASS_INPUT_ERROR = "클래스 입력값을 확인해 주세요.";
export const ADMIN_GYM_INPUT_ERROR = "체육관 입력값을 확인해 주세요.";
export const ADMIN_ID_ERROR = "잘못된 식별자입니다.";
export const COMPLETED_STATUS_ERROR = "완료 처리는 전용 경로를 사용해 주세요.";

export type AdminClassWrite = {
  gym_id: string;
  title: string;
  sport_type: string;
  description: string | null;
  scheduled_at: string;
  duration_minutes: number;
  capacity: number;
  price: number;
  image_url: string | null;
  status: "draft" | "published" | "cancelled";
  age_band: AgeBand;
};

export type AdminGymWrite = {
  name: string;
  description: string | null;
  address: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  image_url: string | null;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const classBody = CreateClassBody.strict().superRefine((value, context) => {
  if (value.title.length > 120) context.addIssue({ code: "custom", message: "title" });
  if (value.sport_type.length > 40) context.addIssue({ code: "custom", message: "sport_type" });
  if ((value.description?.length ?? 0) > 4000) context.addIssue({ code: "custom", message: "description" });
  if ((value.image_url?.length ?? 0) > 2000) context.addIssue({ code: "custom", message: "image_url" });
  if (value.duration_minutes > 24 * 60) context.addIssue({ code: "custom", message: "duration_minutes" });
  if (value.capacity > 500) context.addIssue({ code: "custom", message: "capacity" });
  if (value.price > 10_000_000) context.addIssue({ code: "custom", message: "price" });
});

const gymBody = CreateGymBody.strict().superRefine((value, context) => {
  if (value.name.length > 120) context.addIssue({ code: "custom", message: "name" });
  if (value.address.length > 300) context.addIssue({ code: "custom", message: "address" });
  if (value.city.length > 80) context.addIssue({ code: "custom", message: "city" });
  if ((value.description?.length ?? 0) > 4000) context.addIssue({ code: "custom", message: "description" });
  if ((value.image_url?.length ?? 0) > 2000) context.addIssue({ code: "custom", message: "image_url" });
  if (value.latitude != null && (value.latitude < -90 || value.latitude > 90)) {
    context.addIssue({ code: "custom", message: "latitude" });
  }
  if (value.longitude != null && (value.longitude < -180 || value.longitude > 180)) {
    context.addIssue({ code: "custom", message: "longitude" });
  }
});

export function parseClassId(value: unknown): ParseResult<string> {
  const parsed = CompleteClassParams.safeParse({ classId: value });
  if (!parsed.success) return { ok: false, error: ADMIN_ID_ERROR };
  return { ok: true, value: parsed.data.classId };
}

export function parseParticipantClassId(value: unknown): ParseResult<string> {
  const parsed = ListClassParticipantsParams.safeParse({ classId: value });
  if (!parsed.success) return { ok: false, error: ADMIN_ID_ERROR };
  return { ok: true, value: parsed.data.classId };
}

export function parseUpdateClassId(value: unknown): ParseResult<string> {
  const parsed = UpdateClassParams.safeParse({ classId: value });
  if (!parsed.success) return { ok: false, error: ADMIN_ID_ERROR };
  return { ok: true, value: parsed.data.classId };
}

export function parseGymId(value: unknown): ParseResult<string> {
  const parsed = UpdateGymParams.safeParse({ gymId: value });
  if (!parsed.success) return { ok: false, error: ADMIN_ID_ERROR };
  return { ok: true, value: parsed.data.gymId };
}

export function parseAdminClassWrite(body: unknown): ParseResult<AdminClassWrite> {
  const parsed = classBody.safeParse(body);
  if (!parsed.success) return { ok: false, error: ADMIN_CLASS_INPUT_ERROR };
  if (parsed.data.status === "completed") return { ok: false, error: COMPLETED_STATUS_ERROR };
  if (!isAgeBand(parsed.data.age_band)) return { ok: false, error: ADMIN_CLASS_INPUT_ERROR };
  return {
    ok: true,
    value: {
      gym_id: parsed.data.gym_id,
      title: parsed.data.title,
      sport_type: parsed.data.sport_type,
      description: parsed.data.description ?? null,
      scheduled_at: parsed.data.scheduled_at.toISOString(),
      duration_minutes: parsed.data.duration_minutes,
      capacity: parsed.data.capacity,
      price: parsed.data.price,
      image_url: parsed.data.image_url ?? null,
      status: parsed.data.status,
      age_band: parsed.data.age_band,
    },
  };
}

export function parseAdminGymWrite(body: unknown): ParseResult<AdminGymWrite> {
  const parsed = gymBody.safeParse(body);
  if (!parsed.success) return { ok: false, error: ADMIN_GYM_INPUT_ERROR };
  return {
    ok: true,
    value: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      address: parsed.data.address,
      city: parsed.data.city,
      latitude: parsed.data.latitude ?? null,
      longitude: parsed.data.longitude ?? null,
      image_url: parsed.data.image_url ?? null,
    },
  };
}
