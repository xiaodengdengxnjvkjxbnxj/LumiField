# LumiField modifications to Bible Strong Avatar Lab

Modification date: 2026-08-22

Upstream source is fixed at commit
`175691ab32cefe5faec7828af62f3d50210a8eb2`. The files below are LumiField's
integration changes; the copied files under `third_party/bible-strong-avatar-lab/`
remain byte-for-byte source snapshots unless identified by the hash manifest.

1. Added `public/lf-electronic-pet2-source.js`, an AGPL-covered local adapter
   around the official `createAvatar()` Web Runtime.
2. Generated a static catalog of the ten official Studio avatar presets from
   `src/features/studio/defaultStudioDocument.json`; no geometry is clamped or
   visually re-authored.
3. Applied the official Studio eye-default delta conversion at build/runtime
   integration boundaries so all ten avatar bodies can use the official Strobi
   behavior definition.
4. Exposed avatar, animation, expression, blink, ambient movement and body/eye
   color controls in the visual console's `预设` page, immediately below
   `音域回响`. The controls are not mounted in the expanded `我的` panel;
   their values remain persisted independently for each LF account.
5. Added one-step loop animations to the expression-mode definition. Animation
   mode retains only the 23 official animations, while expression mode retains
   28 expression loops; this keeps validation bounded and avoids frame stalls.
   The loops keep the
   official Runtime animation frame active so its native blink and ambient
   movement logic continue instead of stopping after a static expression blend.
6. When ambient movement is enabled, expressions whose upstream motion is
   `none` use the Runtime's official `microSaccades` eye mode and `slowDrift`
   body mode; disabling the setting restores `none`.
7. Bundled the exact core/Web source into a local IIFE with esbuild and a fixed
   alias to the vendored core. No iframe, CDN, remote fetch or Studio dependency
   is introduced.
8. Added transactional shared-slot switching. The replacement runtime is
   mounted before the visible swap; the old runtime is then destroyed through
   its official `destroy()` lifecycle. Selection is persisted per LF account.

No upstream copyright, AGPL notice or warranty disclaimer has been removed.
