// References to the discontinued separate Recovery image, its Dockerfile and its Compose settings.
// .tdarr-recovery-status.json is the shared status file, not the image.
export const OLD_RECOVERY_IMAGE=/tdarr-recovery(?!-status)|Dockerfile\.recovery|RECOVERY_IMAGE_TAG|RECOVERY_DATA_HOST/;
