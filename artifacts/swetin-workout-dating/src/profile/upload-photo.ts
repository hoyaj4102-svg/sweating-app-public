export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ProfilePhotoUpload = {
  profile_photo_ref: string;
  profile_photo_url: string;
};

export function profilePhotoFileError(file: File): string | null {
  if (!ACCEPTED.has(file.type)) return "지원하는 사진 형식만 올릴 수 있습니다.";
  if (file.size > PROFILE_PHOTO_MAX_BYTES) return "사진 용량이 너무 큽니다.";
  return null;
}

export async function uploadProfilePhoto(file: File): Promise<ProfilePhotoUpload> {
  const response = await fetch("/api/profiles/me/photo", {
    method: "POST",
    headers: { "content-type": file.type },
    body: file,
  });
  const data = await response.json().catch(() => null) as ProfilePhotoUpload | { error?: string } | null;
  if (!response.ok) {
    const error = new Error("profile photo upload failed") as Error & { data?: { error?: string } };
    error.data = data && "error" in data ? { error: data.error } : undefined;
    throw error;
  }
  if (!data || !("profile_photo_ref" in data) || !data.profile_photo_ref) {
    throw new Error("profile photo upload failed");
  }
  return data;
}
