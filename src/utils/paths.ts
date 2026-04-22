export const PROOT_HOME = '/data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs/ubuntu/root';

export function resolvePath(rawPath: string): string {
    return rawPath.replace(/^~(?=$|\/)/, PROOT_HOME);
}
