/**
 * All permission keys used across the application.
 * Must match the PermissionKey type in the frontend (authTypes.ts).
 */
export const PERMISSION_KEYS = {
  ACCESS_CONTROL: 'ACCESS_CONTROL',
  DEVICE_IMPORT: 'DEVICE_IMPORT',
} as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[keyof typeof PERMISSION_KEYS];

export const ALL_PERMISSION_KEYS: PermissionKey[] = Object.values(PERMISSION_KEYS);
