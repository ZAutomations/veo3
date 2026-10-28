"""Ported visual transitions and silence-cut FFmpeg engine from VideoAuotmation.
See PORT_PROVENANCE.json for source files and adapters. No source-tool imports.
"""
from pathlib import Path
from typing import Optional
import math, os, random, subprocess, sys
import numpy as np
from PIL import Image, ImageFilter
try:
    from moviepy import VideoClip, AudioFileClip, CompositeAudioClip, concatenate_videoclips
    from moviepy.video.fx import FadeIn, FadeOut
except ImportError:
    from moviepy.editor import VideoClip, AudioFileClip, CompositeAudioClip, concatenate_videoclips
    from moviepy.video.fx.fadein import fadein as FadeIn
    from moviepy.video.fx.fadeout import fadeout as FadeOut
from moviepy.audio.AudioClip import AudioArrayClip
_TRANSITION_SFX_CLASS = None
_TRANSITION_SFX_GETTER = None


class TransitionEffects:
    """Professional transition effects for video intro/outro"""

    @staticmethod
    def apply_fade_transition(clip, fade_in_duration=0, fade_out_duration=0):
        """Apply fade in/out transitions"""
        if fade_in_duration > 0:
            try:
                clip = clip.with_effects([FadeIn(fade_in_duration)])
            except:
                try:
                    clip = clip.fadein(fade_in_duration)
                except:
                    pass

        if fade_out_duration > 0:
            try:
                from moviepy.video.fx import FadeOut
                clip = clip.with_effects([FadeOut(fade_out_duration)])
            except:
                try:
                    clip = clip.fadeout(fade_out_duration)
                except:
                    pass

        return clip

    @staticmethod
    def create_zoom_transition(clip, zoom_in=True, duration=1.0, zoom_scale=1.3):
        """Create zoom in/out transition effect"""
        try:
            from moviepy import VideoClip
        except ImportError:
            from moviepy.editor import VideoClip

        # Capture the *original* duration before any inner wrap mutates clip.duration
        original_duration = clip.duration

        def zoom_effect(get_frame, t):
            frame = get_frame(t)

            if zoom_in:
                # Zoom from scale to 1.0
                progress = min(t / duration, 1.0)
                current_scale = zoom_scale - (zoom_scale - 1.0) * progress
            else:
                # Zoom from 1.0 to scale
                progress = max((t - (original_duration - duration)) / duration, 0.0)
                current_scale = 1.0 + (zoom_scale - 1.0) * progress

            if abs(current_scale - 1.0) > 0.01:  # Only apply if zoom needed
                h, w = frame.shape[:2]
                new_h, new_w = int(h * current_scale), int(w * current_scale)

                from PIL import Image as PILImage
                pil_frame = PILImage.fromarray(frame)
                pil_frame = pil_frame.resize((new_w, new_h), PILImage.LANCZOS)

                # Crop to original size (center crop)
                crop_x = (new_w - w) // 2
                crop_y = (new_h - h) // 2
                pil_frame = pil_frame.crop((crop_x, crop_y, crop_x + w, crop_y + h))

                return np.array(pil_frame).copy()

            return frame

        try:
            return clip.transform(zoom_effect)
        except:
            return clip.fl(zoom_effect)

    @staticmethod
    def create_blur_transition(clip, blur_in=True, duration=0.5, max_blur=15):
        """Create blur in/out transition"""
        try:
            from moviepy import VideoClip
        except ImportError:
            from moviepy.editor import VideoClip

        # Capture original duration before any wrap
        original_duration = clip.duration

        def blur_effect(get_frame, t):
            frame = get_frame(t)

            if blur_in:
                # Blur from max to 0
                progress = min(t / duration, 1.0)
                blur_amount = int(max_blur * (1 - progress))
            else:
                # Blur from 0 to max
                progress = max((t - (original_duration - duration)) / duration, 0.0)
                blur_amount = int(max_blur * progress)

            if blur_amount > 0:
                pil_img = Image.fromarray(frame)
                pil_img = pil_img.filter(ImageFilter.GaussianBlur(radius=blur_amount))
                return np.array(pil_img).copy()

            return frame

        try:
            return clip.transform(blur_effect)
        except:
            return clip.fl(blur_effect)

    @staticmethod
    def create_slide_transition(clip, direction='left', in_transition=True, duration=0.8):
        """Create slide in/out transition (video slides into frame)"""
        # Capture original duration BEFORE the transform closure so the
        # lambda doesn't reference a MoviePy clip attribute that may change.
        orig_dur = getattr(clip, 'duration', 0) or 0

        def slide_effect(get_frame, t):
            frame = get_frame(t)
            h, w = frame.shape[:2]

            if in_transition:
                progress = min(t / duration, 1.0)
                # Ease out cubic
                progress = 1 - (1 - progress) ** 3
            else:
                progress = max((t - (orig_dur - duration)) / duration, 0.0) if orig_dur > 0 else 1.0
                # Ease in cubic
                progress = min(progress ** 3, 1.0)

            if direction == 'left':
                offset_px = int(w * (1 - progress)) if in_transition else int(-w * progress)
            elif direction == 'right':
                offset_px = int(-w * (1 - progress)) if in_transition else int(w * progress)
            elif direction == 'up':
                offset_px = int(h * (1 - progress)) if in_transition else int(-h * progress)
            elif direction == 'down':
                offset_px = int(-h * (1 - progress)) if in_transition else int(h * progress)
            else:
                offset_px = 0

            if direction in ('left', 'right'):
                out = np.zeros_like(frame)
                if direction == 'left':
                    # Slide in from left: frame slides right from off-screen
                    if in_transition:
                        # offset_px goes from w to 0 over duration
                        src_shift = w - offset_px  # how many pixels of source are visible
                        if offset_px < w:
                            out[:, :src_shift] = frame[:, offset_px:]
                    else:
                        # Slide out to left: frame moves left off-screen
                        if offset_px < 0:
                            out[:, :w + offset_px] = frame[:, -offset_px:]
                        elif offset_px < w:
                            out[:, offset_px:] = frame[:, :w - offset_px]
                else:  # right
                    if in_transition:
                        # Slide in from right
                        if offset_px < 0:
                            out[:, -offset_px:] = frame[:, :w + offset_px]
                    else:
                        # Slide out to right
                        if offset_px > 0:
                            out[:, :w - offset_px] = frame[:, offset_px:]
                return out
            else:  # up/down
                out = np.zeros_like(frame)
                if direction == 'up':
                    if in_transition:
                        # Slide in from top
                        src_shift = h - offset_px
                        if offset_px < h:
                            out[:src_shift] = frame[offset_px:]
                    else:
                        # Slide out to top
                        if offset_px < 0:
                            out[:h + offset_px] = frame[-offset_px:]
                else:  # down
                    if in_transition:
                        # Slide in from bottom
                        if offset_px < 0:
                            out[-offset_px:] = frame[:h + offset_px]
                    else:
                        # Slide out to bottom
                        if offset_px > 0:
                            out[:h - offset_px] = frame[offset_px:]
                return out

        try:
            return clip.transform(slide_effect)
        except AttributeError:
            return clip.fl(slide_effect)

    @staticmethod
    def create_wipe_transition(clip, direction='right', in_transition=True, duration=0.8):
        """Create wipe transition (reveals video gradually)"""
        try:
            from moviepy import VideoClip
        except ImportError:
            from moviepy.editor import VideoClip

        def wipe_effect(get_frame, t):
            frame = get_frame(t)
            h, w = frame.shape[:2]
            mask = np.zeros((h, w), dtype=np.uint8)

            if in_transition:
                progress = min(t / duration, 1.0)
            else:
                progress = 1.0 - max((t - (clip.duration - duration)) / duration, 0.0)

            if direction == 'right':
                reveal_x = int(w * progress)
                mask[:, :reveal_x] = 255
            elif direction == 'left':
                reveal_x = int(w * (1 - progress))
                mask[:, reveal_x:] = 255
            elif direction == 'down':
                reveal_y = int(h * progress)
                mask[:reveal_y, :] = 255
            elif direction == 'up':
                reveal_y = int(h * (1 - progress))
                mask[reveal_y:, :] = 255

            # This is a binary reveal mask. Avoid allocating three-channel
            # float64 intermediates for every full-resolution frame.
            return np.where(mask[:, :, None] != 0, frame, np.uint8(0))

        try:
            return clip.transform(wipe_effect)
        except:
            return clip.fl(wipe_effect)

    @staticmethod
    def create_glitch_transition(clip, glitch_start=True, duration=0.5, intensity=0.5):
        """Create digital glitch transition effect"""
        try:
            from moviepy import VideoClip
        except ImportError:
            from moviepy.editor import VideoClip

        # Capture original duration before any wrap
        original_duration = clip.duration

        def glitch_effect(get_frame, t):
            frame = get_frame(t)

            if glitch_start:
                if t > duration:
                    return frame
                progress = t / duration
            else:
                if t < (original_duration - duration):
                    return frame
                progress = (t - (original_duration - duration)) / duration

            # Apply glitch only during transition
            glitch_amount = intensity * (1 - progress) if glitch_start else intensity * progress

            if glitch_amount > 0.1:
                frame = frame.copy()
                h, w = frame.shape[:2]

                # Reproducible random pattern per-frame
                np.random.seed(int(t * 1000) & 0xFFFFFFFF)

                # RGB channel shift
                shift = int(w * 0.02 * glitch_amount)
                if shift > 0:
                    frame[:, shift:, 0] = frame[:, :-shift, 0]
                    frame[:, :-shift, 2] = frame[:, shift:, 2]

                # Random horizontal slices
                if np.random.random() < glitch_amount:
                    num_slices = int(5 * glitch_amount)
                    for _ in range(num_slices):
                        y1 = np.random.randint(0, h - 10)
                        y2 = y1 + np.random.randint(5, 30)
                        offset = np.random.randint(-int(w * 0.1), int(w * 0.1))
                        if offset > 0:
                            frame[y1:y2, offset:] = frame[y1:y2, :-offset]
                        elif offset < 0:
                            frame[y1:y2, :offset] = frame[y1:y2, -offset:]

            return frame

        try:
            return clip.transform(glitch_effect)
        except:
            return clip.fl(glitch_effect)

    @staticmethod
    def create_bounce_transition(clip, duration=0.6, height=0.3, bounce_start=True):
        """Bouncy vertical pop: frame scales/translates along a sine
        curve during the transition window. Implemented with numpy/PIL
        so the canvas never fills with black from a positioned sub-clip."""
        import math as _m
        import numpy as _np

        original_duration = clip.duration

        def bounce_effect(get_frame, t):
            frame = get_frame(t)
            # Outside the transition window: pass through unchanged
            if bounce_start:
                if t > duration:
                    return frame
                progress = t / duration
            else:
                if t < (original_duration - duration):
                    return frame
                progress = (t - (original_duration - duration)) / duration
            # Bounce curve: peak at mid, 0 at endpoints
            k = 1.0 - progress if bounce_start else progress
            sin_v = _m.sin(k * _m.pi)
            scale = 1.0 + height * sin_v * (1.0 - k * 0.4)
            ty = -int(frame.shape[0] * height * 0.6 * sin_v)
            if abs(scale - 1.0) < 0.01 and ty == 0:
                return frame
            h, w = frame.shape[:2]
            new_h = max(1, int(round(h * scale)))
            new_w = max(1, int(round(w * scale)))
            # Resize frame with PIL
            try:
                from PIL import Image as _PILImage
                pil_src = _PILImage.fromarray(frame)
                pil_dst = pil_src.resize((new_w, new_h), _PILImage.BILINEAR)
                resized = _np.asarray(pil_dst)
            except Exception:
                # Fallback: nearest-neighbor repeat
                rs_h = max(1, int(round(1.0 / scale))) if scale > 0 else 1
                rs_w = rs_h
                resized = _np.repeat(_np.repeat(frame, rs_h, axis=0), rs_w, axis=1)
                rh, rw = resized.shape[:2]
                if rh != new_h or rw != new_w:
                    if rh > new_h:
                        resized = resized[:new_h, :]
                    elif rh < new_h:
                        pad = _np.zeros((new_h - rh, rw, 3), dtype=resized.dtype)
                        resized = _np.concatenate([resized, pad], axis=0)
                    if rw > new_w:
                        resized = resized[:, :new_w]
                    elif rw < new_w:
                        pad = _np.zeros((new_h, new_w - rw, 3), dtype=resized.dtype)
                        resized = _np.concatenate([resized, pad], axis=1)
            # Center the resized image on the original canvas, with vertical offset
            cy_src = new_h // 2 - ty
            cx_src = new_w // 2
            sy0 = max(0, cy_src - h // 2)
            sy1 = sy0 + h
            sx0 = max(0, cx_src - w // 2)
            sx1 = sx0 + w
            sy0 = max(0, min(sy0, max(0, new_h - h)))
            sy1 = sy0 + h
            sx0 = max(0, min(sx0, max(0, new_w - w)))
            sx1 = sx0 + w
            crop = resized[sy0:sy1, sx0:sx1]
            ch, cw = crop.shape[:2]
            if ch == h and cw == w:
                return crop
            out = _np.zeros_like(frame)
            oh = min(h, ch)
            ow = min(w, cw)
            out[:oh, :ow] = crop[:oh, :ow]
            return out

        try:
            return clip.transform(bounce_effect)
        except Exception:
            return clip.fl(bounce_effect)

    @staticmethod
    def _parse_hex_color(hex_str, default=(0, 0, 0)):
        """Convert '#RRGGBB' hex string to (R, G, B) tuple."""
        if not hex_str or not isinstance(hex_str, str) or not hex_str.startswith('#'):
            return default
        try:
            return (int(hex_str[1:3], 16), int(hex_str[3:5], 16), int(hex_str[5:7], 16))
        except (ValueError, IndexError):
            return default

    @staticmethod
    def create_mask_reveal(clip, duration=0.6, shape='circle', direction='in', mask_start=True, bg_color='black'):
        """Wipe in/out using a shape mask (circle / square / diamond / star).
        Uses a per-frame numpy mask to keep it dependency-light.

        ``bg_color`` can be ``'black'`` or a hex string like ``'#FF0000'``.
        """
        try:
            from moviepy import VideoClip
        except ImportError:
            from moviepy.editor import VideoClip
        import numpy as _np

        original_duration = clip.duration

        def _shape_mask(h, w, shape, progress):
            mask = _np.zeros((h, w), dtype=_np.float32)
            cy, cx = h / 2.0, w / 2.0
            max_r = _np.sqrt((cx) ** 2 + (cy) ** 2)
            r = max_r * (1.0 - progress) + 1.0
            yy, xx = _np.ogrid[:h, :w]
            if shape == 'circle':
                d = _np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
                mask = (d <= r).astype(_np.float32)
            elif shape == 'square':
                d = _np.maximum(_np.abs(xx - cx), _np.abs(yy - cy))
                mask = (d <= r).astype(_np.float32)
            elif shape == 'diamond':
                d = (_np.abs(xx - cx) + _np.abs(yy - cy))
                mask = (d <= r).astype(_np.float32)
            elif shape == 'star':
                # 5-point star: combine two rotated triangles approx
                a1 = _np.arctan2(yy - cy, xx - cx)
                rad = _np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
                lobes = 5
                wave = 0.5 + 0.5 * _np.cos(lobes * a1)
                r_eff = r * (0.45 + 0.55 * wave)
                mask = (rad <= r_eff).astype(_np.float32)
            return mask

        def mask_effect(get_frame, t):
            frame = get_frame(t)
            if mask_start:
                if t > duration:
                    return frame
                progress = 1.0 - (t / duration)  # opens up
            else:
                if t < (original_duration - duration):
                    return frame
                progress = (t - (original_duration - duration)) / duration  # closes
            h, w = frame.shape[:2]
            mask = _shape_mask(h, w, shape, max(0.0, min(1.0, progress)))
            mask3 = _np.stack([mask, mask, mask], axis=-1)
            try:
                # Background color when mask is closed
                if bg_color and bg_color != 'black':
                    _rgb = TransitionEffects._parse_hex_color(bg_color, (0, 0, 0))
                    bg = _np.full(frame.shape, _rgb, dtype=_np.uint8)
                else:
                    bg = _np.zeros_like(frame)
                out = (frame.astype(_np.float32) * mask3 + bg.astype(_np.float32) * (1 - mask3))
                return out.astype(_np.uint8)
            except Exception:
                return frame

        try:
            return clip.transform(mask_effect)
        except Exception:
            return clip.fl(mask_effect)

    @staticmethod
    def create_bounce_mask_transition(clip, duration=0.8, height=0.25, shape='circle', mask_start=True, bg_color='black'):
        """Combo: bounce frame + reveal/close through a shape mask.
        Implemented as a single per-frame callback that combines both."""
        try:
            from moviepy import VideoClip
        except ImportError:
            from moviepy.editor import VideoClip
        import numpy as _np
        import math as _m

        original_duration = clip.duration

        def combo(get_frame, t):
            frame = get_frame(t)
            if mask_start:
                if t > duration:
                    return frame
                p = 1.0 - (t / duration)
            else:
                if t < (original_duration - duration):
                    return frame
                p = (t - (original_duration - duration)) / duration
            p = max(0.0, min(1.0, p))
            # bounce component (numpy-based so canvas never gets black gaps)
            k = 1.0 - p if mask_start else p
            sin_v = _m.sin(k * _m.pi)
            scale = 1.0 + height * 0.2 * sin_v
            ty = -int(frame.shape[0] * height * 0.5 * sin_v)
            h, w = frame.shape[:2]
            if abs(scale - 1.0) >= 0.01 or ty != 0:
                new_h = max(1, int(round(h * scale)))
                new_w = max(1, int(round(w * scale)))
                try:
                    from PIL import Image as _PILImage
                    pil_src = _PILImage.fromarray(frame)
                    pil_dst = pil_src.resize((new_w, new_h), _PILImage.BILINEAR)
                    resized = _np.asarray(pil_dst)
                except Exception:
                    rs = max(1, int(round(1.0 / scale))) if scale > 0 else 1
                    resized = _np.repeat(_np.repeat(frame, rs, axis=0), rs, axis=1)
                    rh, rw = resized.shape[:2]
                    if rh > new_h: resized = resized[:new_h, :]
                    elif rh < new_h:
                        pad = _np.zeros((new_h - rh, rw, 3), dtype=resized.dtype)
                        resized = _np.concatenate([resized, pad], axis=0)
                    if rw > new_w: resized = resized[:, :new_w]
                    elif rw < new_w:
                        pad = _np.zeros((new_h, new_w - rw, 3), dtype=resized.dtype)
                        resized = _np.concatenate([resized, pad], axis=1)
                cy_src = new_h // 2 - ty
                cx_src = new_w // 2
                sy0 = max(0, min(cy_src - h // 2, max(0, new_h - h)))
                sx0 = max(0, min(cx_src - w // 2, max(0, new_w - w)))
                crop = resized[sy0:sy0 + h, sx0:sx0 + w]
                ch, cw = crop.shape[:2]
                if ch == h and cw == w:
                    frame = crop
                else:
                    out0 = _np.zeros_like(frame)
                    oh, ow = min(h, ch), min(w, cw)
                    out0[:oh, :ow] = crop[:oh, :ow]
                    frame = out0
            # mask reveal
            cy, cx = h / 2.0, w / 2.0
            max_r = _np.sqrt(cx ** 2 + cy ** 2)
            r = max_r * p + 1.0
            yy, xx = _np.ogrid[:h, :w]
            if shape == 'circle':
                d = _np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
            elif shape == 'square':
                d = _np.maximum(_np.abs(xx - cx), _np.abs(yy - cy))
            elif shape == 'diamond':
                d = (_np.abs(xx - cx) + _np.abs(yy - cy))
            else:
                d = _np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
            mask = (d <= r).astype(_np.float32)
            mask3 = _np.stack([mask, mask, mask], axis=-1)
            if bg_color and bg_color != 'black':
                _rgb = TransitionEffects._parse_hex_color(bg_color, (0, 0, 0))
                bg = _np.full(frame.shape, _rgb, dtype=_np.uint8)
            else:
                bg = _np.zeros_like(frame)
            out = (frame.astype(_np.float32) * mask3 + bg.astype(_np.float32) * (1 - mask3))
            return out.astype(_np.uint8)

        try:
            return clip.transform(combo)
        except Exception:
            return clip.fl(combo)

    @staticmethod
    def create_cinematic_bars(clip, fade_in=True, duration=0.8, bar_height_percent=10):
        """Create cinematic letterbox bars (black bars top/bottom).
        The bars are produced as a per-frame RGB clip that reads the
        underlying frame and only paints the bar strips black — so the
        rest of the frame stays unchanged (no fully-black overlay)."""
        try:
            from moviepy import VideoClip
        except ImportError:
            from moviepy.editor import VideoClip
        import numpy as _np

        original_duration = clip.duration
        w, h = clip.size
        bar_h = int(h * bar_height_percent / 100)

        def bars_effect(get_frame, t):
            frame = get_frame(t)
            if fade_in:
                progress = min(max(t / duration, 0.0), 1.0)
                cur = int(bar_h * progress)
            else:
                cur = bar_h
            out = frame.copy()
            if cur > 0:
                out[:cur, :] = 0
                out[-cur:, :] = 0
            return out

        try:
            return clip.transform(bars_effect)
        except Exception:
            return clip.fl(bars_effect)

    # === Pulse / interval transitions ====================================
    # These apply a quick visual pulse at every `interval` seconds, similar
    # to how the cinematic effects use repeat mode.

    @staticmethod
    def _apply_pulse_transform(clip, transform_fn, pulse_duration, interval, start_offset=0.0):
        """Single-pulse wrapper. See compose_pulses() for the fast multi-pulse path."""
        return TransitionEffects.compose_pulses(
            clip, [(transform_fn, pulse_duration, interval, start_offset)])

    @staticmethod
    def compose_pulses(clip, pulse_specs, start_offset=0.0):
        """Apply MANY pulse transforms in a SINGLE .transform() call so moviepy
        only re-encodes the clip once.

        pulse_specs: list of (transform_fn, pulse_duration, interval, kw)
            where transform_fn has signature (get_frame, t, t_in_pulse, **kw) -> frame.
        This replaces the old pattern of calling each create_*_pulse in a loop,
        which did 4 separate re-encodes and made renders 4x slower.
        """
        active = [(fn, dur, intv, kw) for (fn, dur, intv, kw) in pulse_specs
                  if fn is not None and intv and intv > 0 and dur and dur > 0]
        if not active:
            return clip

        def combined_transform(get_frame, t):
            # Apply each active pulse in order. Each pulse is only invoked
            # during its own time window. The previous frame is passed
            # through the chain (no intermediate re-encoding).
            cur = get_frame(t)
            for transform_fn, dur, intv, kw in active:
                if t < start_offset:
                    continue
                t_rel = t - start_offset
                t_in_pulse = t_rel - (int(t_rel / intv) * intv)
                if 0 <= t_in_pulse <= dur:
                    # Build a get_frame that returns the current frame so
                    # the pulse's transform_fn sees our chained output, not
                    # the original clip. This is the key to the speedup:
                    # only one .transform() runs on the clip.
                    def make_get_frame(captured, _fn=transform_fn, _t=t,
                                       _tip=t_in_pulse, _kw=kw):
                        def _gf(_t):
                            return _fn(lambda __: captured, _t, _tip, **_kw)
                        return _gf
                    cur = make_get_frame(cur)(t)
            return cur

        try:
            return clip.transform(combined_transform)
        except AttributeError:
            try:
                return clip.fl(combined_transform, apply_to=['mask'])
            except Exception:
                return clip.fl(combined_transform)

    @staticmethod
    def create_zoom_pulse(clip, duration=1.0, zoom_scale=1.3, interval=8.0, start_offset=0.0):
        """Zoom-in then zoom-back pulse, applied every `interval` seconds."""

        def transform(get_frame, t, t_in_pulse):
            progress = min(t_in_pulse / duration, 1.0)
            # Triangle wave: up then back down
            tri = progress if progress < 0.5 else (1.0 - progress)
            scale = 1.0 + (zoom_scale - 1.0) * (tri * 2)
            frame = get_frame(t)
            if abs(scale - 1.0) > 0.01:
                h, w = frame.shape[:2]
                new_h, new_w = int(h * scale), int(w * scale)
                from PIL import Image as PILImage
                pil_frame = PILImage.fromarray(frame)
                pil_frame = pil_frame.resize((new_w, new_h), PILImage.LANCZOS)
                crop_x = (new_w - w) // 2
                crop_y = (new_h - h) // 2
                pil_frame = pil_frame.crop((crop_x, crop_y, crop_x + w, crop_y + h))
                return np.array(pil_frame).copy()
            return frame

        return TransitionEffects._apply_pulse_transform(clip, transform, duration, interval, start_offset)

    @staticmethod
    def create_blur_pulse(clip, duration=0.5, max_blur=15, interval=8.0, start_offset=0.0):
        """Blur-up then blur-back pulse, applied every `interval` seconds."""

        def transform(get_frame, t, t_in_pulse):
            progress = min(t_in_pulse / duration, 1.0)
            tri = progress if progress < 0.5 else (1.0 - progress)
            blur_amount = int(max_blur * (tri * 2))
            frame = get_frame(t)
            if blur_amount > 0:
                pil_img = Image.fromarray(frame)
                pil_img = pil_img.filter(ImageFilter.GaussianBlur(radius=blur_amount))
                return np.array(pil_img).copy()
            return frame

        return TransitionEffects._apply_pulse_transform(clip, transform, duration, interval, start_offset)

    @staticmethod
    def create_glitch_pulse(clip, duration=0.5, intensity=0.5, interval=8.0, start_offset=0.0):
        """Glitch burst pulse, applied every `interval` seconds."""

        def transform(get_frame, t, t_in_pulse):
            progress = min(t_in_pulse / duration, 1.0)
            glitch_amount = intensity * (1.0 - progress)
            frame = get_frame(t)
            if glitch_amount > 0.1:
                frame = frame.copy()
                h, w = frame.shape[:2]
                np.random.seed(int(t * 1000) & 0xFFFFFFFF)
                shift = int(w * 0.02 * glitch_amount)
                if shift > 0:
                    frame[:, shift:, 0] = frame[:, :-shift, 0]
                    frame[:, :-shift, 2] = frame[:, shift:, 2]
                if np.random.random() < glitch_amount:
                    num_slices = int(5 * glitch_amount)
                    for _ in range(num_slices):
                        y1 = np.random.randint(0, max(1, h - 10))
                        y2 = y1 + np.random.randint(5, 30)
                        offset = np.random.randint(-int(w * 0.1), int(w * 0.1))
                        if offset > 0:
                            frame[y1:y2, offset:] = frame[y1:y2, :-offset]
                        elif offset < 0:
                            frame[y1:y2, :offset] = frame[y1:y2, -offset:]
            return frame

        return TransitionEffects._apply_pulse_transform(clip, transform, duration, interval, start_offset)

    @staticmethod
    def create_shake_pulse(clip, duration=0.5, intensity=0.05, interval=8.0, start_offset=0.0):
        """Camera-shake pulse, applied every `interval` seconds."""

        def transform(get_frame, t, t_in_pulse):
            progress = min(t_in_pulse / duration, 1.0)
            tri = progress if progress < 0.5 else (1.0 - progress)
            frame = get_frame(t)
            if tri > 0.05:
                h, w = frame.shape[:2]
                amp = int(min(w, h) * intensity * tri)
                np.random.seed(int(t * 1000) & 0xFFFFFFFF)
                dx = np.random.randint(-amp, amp + 1)
                dy = np.random.randint(-amp, amp + 1)
                frame = np.roll(frame, shift=(dy, dx), axis=(0, 1))
                # Fill the wrap-around border with a blurred edge
                if dx != 0:
                    edge_w = min(20, w // 10)
                    if dx > 0:
                        frame[:, :edge_w] = frame[:, edge_w:edge_w + edge_w]
                    else:
                        frame[:, -edge_w:] = frame[:, -2*edge_w:-edge_w]
                if dy != 0:
                    edge_h = min(20, h // 10)
                    if dy > 0:
                        frame[:edge_h, :] = frame[edge_h:edge_h + edge_h, :]
                    else:
                        frame[-edge_h:, :] = frame[-2*edge_h:-edge_h, :]
            return frame

        return TransitionEffects._apply_pulse_transform(clip, transform, duration, interval, start_offset)

    # ===== New CapCut-style transitions =================================

    @staticmethod
    def create_radial_wipe(clip, direction='in', duration=0.8, center_x=50, center_y=50):
        """Radial/Circular wipe — reveals clip via an expanding/shrinking circle.

        direction='in':  Wipe from edges toward center (circle shrinks)
        direction='out': Wipe from center outward (circle expands)

        This is the classic CapCut circle-intro / circle-outro transition.
        Uses per-frame numpy masking so the effect is baked into RGB.
        """

        original_duration = clip.duration

        def radial_effect(get_frame, t):
            frame = get_frame(t)
            h, w = frame.shape[:2]
            cx = int(w * center_x / 100)
            cy = int(h * center_y / 100)
            max_radius = int(np.sqrt(cx*cx + cy*cy) if direction == 'in'
                             else np.sqrt((w-cx)**2 + (h-cy)**2))

            progress = min(t / duration, 1.0)
            p = 1 - (1 - progress) ** 3  # ease-out cubic
            if direction == 'in':
                r = int(max_radius * (1 - p))
            else:
                r = int(max_radius * p)
            if r <= 0:
                return np.zeros_like(frame)
            mask = np.zeros((h, w), dtype=np.uint8)
            yg, xg = np.ogrid[:h, :w]
            dist = np.sqrt((xg - cx)**2 + (yg - cy)**2)
            feather = min(10, r // 4)
            if feather < 1:
                feather = 1
            mask[dist <= r] = 255
            if feather > 1:
                soft_band = (dist > r) & (dist <= r + feather)
                mask[soft_band] = np.clip((1 - (dist[soft_band] - r) / feather) * 255, 0, 255).astype(np.uint8)

            mask3 = np.stack([mask, mask, mask], axis=-1)
            bg = np.zeros_like(frame)
            return (frame.astype(np.float32) * (mask3 / 255.0) +
                    bg * (1.0 - mask3 / 255.0)).astype(np.uint8)

        try:
            return clip.transform(radial_effect)
        except AttributeError:
            return clip.fl(radial_effect)

    @staticmethod
    def create_color_dissolve(clip, direction='in', duration=0.8, color='#FFFFFF', ease_power=2):
        """Color dissolve — fades through a solid color (like CapCut's flash dissolve).

        direction='in':  Original → color → full visibility (flash through color at start)
        direction='out': Full visibility → color → black/nothing (flash through color at end)

        Works by blending the frame with a solid color over time.
        """
        try:
            from moviepy import VideoClip
        except ImportError:
            from moviepy.editor import VideoClip

        # Parse color
        color = color.lstrip('#')
        if len(color) == 6:
            col_rgb = tuple(int(color[i:i+2], 16) for i in (0, 2, 4))
        else:
            col_rgb = (255, 255, 255)

        import cv2  # noqa: F811 — local import for cv2.addWeighted

        original_duration = clip.duration

        def color_dissolve_effect(get_frame, t):
            frame = get_frame(t)
            if direction == 'in':
                progress = min(t / duration, 1.0)
                # Progress rises 0→1: dissolve to color then dissolve to frame
                if progress < 0.5:
                    blend = progress * 2  # 0→1 in first half
                    return cv2.addWeighted(frame, 1 - blend,
                                           np.full_like(frame, col_rgb), blend, 0)
                else:
                    blend = (progress - 0.5) * 2  # 0→1 in second half
                    return cv2.addWeighted(np.full_like(frame, col_rgb), 1 - blend,
                                           frame, blend, 0)
            else:
                # direction='out'
                progress = max((t - (original_duration - duration)) / duration, 0.0)
                progress = min(progress, 1.0)
                if progress < 0.5:
                    blend = progress * 2
                    return cv2.addWeighted(frame, 1.0 - blend,
                                           np.full_like(frame, col_rgb), blend, 0)
                else:
                    blend = (progress - 0.5) * 2
                    fade_out = 1 - blend
                    return cv2.addWeighted(np.full_like(frame, col_rgb), fade_out,
                                           frame, fade_out, 0)  # Both to color and fade

        try:
            return clip.transform(color_dissolve_effect)
        except AttributeError:
            return clip.fl(color_dissolve_effect)

    @staticmethod
    def create_split_wipe(clip, direction='horizontal', in_transition=True, duration=0.8):
        """Split wipe — reveals the clip as if doors or curtains opening.

        direction='horizontal': Left and right halves slide apart
        direction='vertical':   Top and bottom halves slide apart
        direction='diagonal':   Four corners slide outward
        in_transition=True:     Opening (revealing the clip)
        in_transition=False:    Closing (hiding the clip)

        Uses per-frame numpy masking so the effect is baked into RGB.
        """
        original_duration = clip.duration

        def split_effect(get_frame, t):
            frame = get_frame(t)
            h, w = frame.shape[:2]
            mask = np.ones((h, w), dtype=np.uint8) * 255

            if in_transition:
                progress = min(t / duration, 1.0)
            else:
                progress = min(max((t - (original_duration - duration)) / duration, 0.0), 1.0)
            p = 1 - (1 - progress) ** 3  # ease-out cubic

            if direction == 'horizontal':
                half = w // 2
                left_reveal = int(half * p)
                right_reveal = int((w - half) * p)
                mask[:, :half] = 0
                mask[:, half:] = 0
                mask[:, half - left_reveal:half + right_reveal] = 255
            elif direction == 'vertical':
                half = h // 2
                top_reveal = int(half * p)
                bottom_reveal = int((h - half) * p)
                mask[:half, :] = 0
                mask[half:, :] = 0
                mask[half - top_reveal:half + bottom_reveal, :] = 255
            elif direction == 'diagonal':
                cx, cy = w // 2, h // 2
                yg, xg = np.ogrid[:h, :w]
                dist = np.minimum.reduce([
                    np.sqrt(xg**2 + yg**2),
                    np.sqrt((w-xg)**2 + yg**2),
                    np.sqrt(xg**2 + (h-yg)**2),
                    np.sqrt((w-xg)**2 + (h-yg)**2),
                ])
                max_dist = np.sqrt(cx**2 + cy**2)
                threshold = max_dist * p
                mask[dist > threshold] = 0
                mask[dist <= threshold] = 255

            # This is a binary reveal mask. Avoid allocating three-channel
            # float64 intermediates for every full-resolution frame.
            return np.where(mask[:, :, None] != 0, frame, np.uint8(0))

        try:
            return clip.transform(split_effect)
        except AttributeError:
            return clip.fl(split_effect)

    @staticmethod
    def create_luma_wipe(clip, direction='in', duration=0.8, edge_feather=4):
        """Luma/Brightness wipe — the frame brightens/saturates to reveal.

        Works by boosting the brightness (luma) progressively until full reveal.
        Gives a smooth 'bloom' or 'flash' effect similar to CapCut's lumafade.

        direction='in':  Gets brighter over time (revealing the image)
        direction='out': Gets darker over time (hiding the image)
        """
        try:
            from moviepy import VideoClip
        except ImportError:
            from moviepy.editor import VideoClip

        original_duration = clip.duration

        def luma_effect(get_frame, t):
            frame = get_frame(t)
            if direction == 'in':
                progress = min(t / duration, 1.0)
            else:
                progress = min(max((t - (original_duration - duration)) / duration, 0.0), 1.0)
                progress = 1 - progress

            # Smooth step
            p = 1 - (1 - progress) ** 2

            if p >= 1.0:
                return frame

            # Boost luma and saturation proportional to progress
            frame_f = frame.astype(np.float32)
            # Convert to YUV-like for luma boost
            luma = 0.299 * frame_f[:,:,2] + 0.587 * frame_f[:,:,1] + 0.114 * frame_f[:,:,0]
            luma_boost = luma * (0.5 * (1 - p))  # Boost up to 0.5x
            result = frame_f + luma_boost[:,:,np.newaxis]

            # Also reduce contrast for a hazy/flash look in early phase
            if p < 0.5:
                fade = (0.5 - p) * 2  # 1→0 as p goes 0→0.5
                avg = np.mean(result, axis=(0,1), keepdims=True)
                result = result * (1 - fade * 0.3) + avg * (fade * 0.3)

            return np.clip(result, 0, 255).astype(np.uint8)

        try:
            return clip.transform(luma_effect)
        except AttributeError:
            return clip.fl(luma_effect)


def _load_sfx():
    """Lazy-load the transition SFX module. Returns (class, getter) or (None, None)."""
    global _TRANSITION_SFX_CLASS, _TRANSITION_SFX_GETTER
    if _TRANSITION_SFX_CLASS is not None:
        return _TRANSITION_SFX_CLASS, _TRANSITION_SFX_GETTER
    try:
        import sys as _sys
        sfx_path = Path(__file__).parent / "VoiceModules" / "TransitionSFX"
        if str(sfx_path) not in _sys.path:
            _sys.path.insert(0, str(sfx_path))
        from transition_sfx import TransitionSFX, get_sfx_name  # noqa
        _TRANSITION_SFX_CLASS = TransitionSFX
        _TRANSITION_SFX_GETTER = get_sfx_name
        return TransitionSFX, get_sfx_name
    except Exception as e:
        print(f"[WARNING] Transition SFX module not available: {e}")
        return None, None


def _sfx_name_for(transition_name: str):
    _, getter = _load_sfx()
    if getter is None:
        return None
    return getter(transition_name)


def _make_sfx_clip(sfx_name: str, duration: float, start_time: float, fps: int, volume: float,
                   custom_file: Optional[str] = None, custom_volume: Optional[float] = None):
    """Create a MoviePy AudioArrayClip for a transition SFX.
    If `custom_file` is provided and exists, loads the user's audio file
    (wav/mp3/ogg) and trims/pads to the target duration. Otherwise falls
    back to the procedural SFX named by `sfx_name`.
    `custom_volume` is used only when a custom file is loaded; the
    procedural fallback always uses `volume`."""
    if AudioArrayClip is None:
        print(f"[SFX-DEBUG] AudioArrayClip not available; SFX '{sfx_name}' skipped")
        return None
    # 1) Custom SFX file path takes priority
    if custom_file:
        try:
            from pathlib import Path as _P
            cpath = _P(custom_file)
            if cpath.exists() and cpath.is_file():
                cv = custom_volume if custom_volume is not None else volume
                arr = _load_custom_sfx_audio(cpath, duration, cv, fps)
                if arr is not None and len(arr) > 0:
                    clip = AudioArrayClip(arr, fps=fps)
                    try:
                        return clip.with_start(start_time)
                    except AttributeError:
                        return clip.set_start(start_time)
                else:
                    print(f"[SFX-DEBUG] Custom SFX '{custom_file}' produced empty array, falling back to procedural '{sfx_name}'")
        except Exception as e:
            print(f"[SFX-DEBUG] Custom SFX load failed for '{custom_file}': {type(e).__name__}: {e}, falling back to procedural")
    # 2) Procedural fallback
    sfx_class, _ = _load_sfx()
    if sfx_class is None:
        print(f"[SFX-DEBUG] SFX class not loadable; SFX '{sfx_name}' skipped")
        return None
    try:
        sfx = sfx_class(sr=fps)
        arr = sfx.make_audio_array(sfx_name, duration=duration, volume=volume, channels=2)
        if arr is None or len(arr) == 0:
            print(f"[SFX-DEBUG] SFX '{sfx_name}' produced empty array")
            return None
        clip = AudioArrayClip(arr, fps=fps)
        # set_start works in both MoviePy 1.x and 2.x
        try:
            return clip.with_start(start_time)
        except AttributeError:
            return clip.set_start(start_time)
    except Exception as e:
        print(f"[SFX-DEBUG] SFX generation failed for '{sfx_name}' at t={start_time}: {type(e).__name__}: {e}")
        return None


def _load_custom_sfx_audio(path, duration: float, volume: float, fps: int) -> Optional[np.ndarray]:
    """Load a user-supplied SFX file (wav/mp3/ogg) and return a stereo
    float32 array of shape (n_samples, 2) trimmed/padded to `duration` seconds."""
    try:
        suffix = path.suffix.lower()
        # Try soundfile first (handles wav/ogg/flac natively)
        data = None
        file_sr = fps
        try:
            import soundfile as sf
            data, file_sr = sf.read(str(path), dtype='float32')
        except Exception:
            # Fall back to moviepy's AudioFileClip (handles mp3 too)
            try:
                from moviepy.audio.io.AudioFileClip import AudioFileClip
                clip = AudioFileClip(str(path))
                data = clip.to_soundarray(fps=fps)
                if data.ndim == 2 and data.shape[1] == 1:
                    data = data[:, 0]
                elif data.ndim == 2 and data.shape[1] == 2:
                    data = data.mean(axis=1)  # downmix to mono first
                file_sr = fps
                try:
                    clip.close()
                except Exception:
                    pass
            except Exception as e2:
                print(f"[SFX-DEBUG] Could not load custom SFX '{path}' with soundfile or AudioFileClip: {e2}")
                return None
        if data is None or len(data) == 0:
            return None
        # Convert to mono float32
        if data.ndim == 2:
            data = data.mean(axis=1)
        data = data.astype(np.float32, copy=False)
        # Resample if needed
        if file_sr != fps:
            n_target = int(len(data) * fps / file_sr)
            data = np.interp(
                np.linspace(0, len(data), n_target),
                np.arange(len(data)),
                data
            ).astype(np.float32)
        # Apply volume
        data = data * float(volume)
        # Trim or pad to target duration
        target_n = int(duration * fps)
        if len(data) > target_n:
            data = data[:target_n]
        elif len(data) < target_n:
            pad = np.zeros(target_n - len(data), dtype=np.float32)
            data = np.concatenate([data, pad])
        # Convert to stereo (n, 2)
        stereo = np.stack([data, data], axis=-1)
        return stereo
    except Exception as e:
        print(f"[SFX-DEBUG] _load_custom_sfx_audio failed for '{path}': {type(e).__name__}: {e}")
        return None


def _resolve_sfx_for_transition(settings, enabled_key, sfx_tname):
    """Resolve which SFX to use for a transition: per-transition dropdown →
    custom SFX file → procedural fallback.

    Returns:
        (sfx_name_or_None, custom_file_or_None, custom_volume_or_None)
    """
    # Per-transition dropdown setting (e.g. 'transition_sfx_fade_in')
    sfx_override_key = f"transition_sfx_{enabled_key.removeprefix('transition_')}"
    dropdown_val = settings.get(sfx_override_key, '(default)')

    if dropdown_val not in ('(default)', 'None', '(none)', '', None):
        # User selected a specific SFX from the dropdown
        return dropdown_val, None, None

    # Check custom SFX file (works as global fallback when no Target is set)
    custom_file = settings.get('custom_sfx_file', '')
    if custom_file and Path(custom_file).is_file():
        cv = float(settings.get('custom_sfx_volume', 0.8))
        sfx_name = _sfx_name_for(sfx_tname)  # procedural name for duration/format
        return sfx_name, custom_file, cv

    # Procedural fallback
    sfx_name = _sfx_name_for(sfx_tname)
    if not sfx_name:
        # Last-resort fallback: pick a generic SFX that always produces
        # valid audio so users never get silent transitions
        _FALLBACK_SFX = {
            'fade': 'shimmer',
            'zoom': 'whoosh',
            'blur': 'boom',
            'slide': 'whoosh',
            'wipe': 'swoosh',
            'glitch': 'glitch',
            'bounce': 'impact',
        }
        fallback_key = sfx_tname.split('_')[0]  # e.g. 'zoom_in' → 'zoom'
        sfx_name = _FALLBACK_SFX.get(fallback_key, 'shimmer')
        print(f"[SFX-DEBUG] _sfx_name_for('{sfx_tname}') returned None — "
              f"falling back to '{sfx_name}'")
    return sfx_name, None, None


def _apply_segment_transitions(sub_clips, settings, transition_duration=0.3,
                                min_interval=0.0):
    """Apply enabled Transitions-tab transitions to segment boundaries and generate SFX.

    For each segment boundary, this applies enabled 'in' transitions to the start
    of the next segment and enabled 'out' transitions to the tail of the previous
    segment, then returns audio SFX clips timed at each boundary.

    If min_interval > 0, transitions are only applied at boundaries where at least
    `min_interval` seconds of cumulative video time has elapsed since the last
    applied transition. Crossfade-only boundaries still receive SFX from the
    calling code.

    Returns:
        (modified_sub_clips, sfx_audio_clips)
    """
    # (enabled_key, type, method, dur_key, {extra_kw}, sfx_tname, duration_param_name)
    _TR_SPECS = [
        ('transition_fade_in',      'in',  'apply_fade_transition',
         'transition_fade_in_duration',  {}, 'fade', 'fade_in_duration'),
        ('transition_fade_out',     'out', 'apply_fade_transition',
         'transition_fade_out_duration', {}, 'fade', 'fade_out_duration'),
        ('transition_zoom_in',      'in',  'create_zoom_transition',
         'transition_zoom_in_duration',  {'zoom_in': True}, 'zoom_in', 'duration'),
        ('transition_zoom_out',     'out', 'create_zoom_transition',
         'transition_zoom_out_duration', {'zoom_in': False}, 'zoom_out', 'duration'),
        ('transition_blur_in',      'in',  'create_blur_transition',
         'transition_blur_duration',     {'blur_in': True}, 'blur_in', 'duration'),
        ('transition_blur_out',     'out', 'create_blur_transition',
         'transition_blur_duration',     {'blur_in': False}, 'blur_out', 'duration'),
        ('transition_slide_in',     'in',  'create_slide_transition',
         'transition_slide_duration',
         {'in_transition': True,
          'direction': lambda s: s.get('transition_slide_direction', 'left')},
         'slide_in', 'duration'),
        ('transition_slide_out',    'out', 'create_slide_transition',
         'transition_slide_duration',
         {'in_transition': False,
          'direction': lambda s: s.get('transition_slide_direction', 'left')},
         'slide_out', 'duration'),
        ('transition_wipe_in',      'in',  'create_wipe_transition',
         'transition_wipe_duration',
         {'in_transition': True,
          'direction': lambda s: s.get('transition_wipe_direction', 'right')},
         'wipe_in', 'duration'),
        ('transition_wipe_out',     'out', 'create_wipe_transition',
         'transition_wipe_duration',
         {'in_transition': False,
          'direction': lambda s: s.get('transition_wipe_direction', 'right')},
         'wipe_out', 'duration'),
        ('transition_glitch_start', 'in',  'create_glitch_transition',
         'transition_glitch_duration',    {'glitch_start': True}, 'glitch_start', 'duration'),
        ('transition_glitch_end',   'out', 'create_glitch_transition',
         'transition_glitch_duration',    {'glitch_start': False}, 'glitch_end', 'duration'),
        ('transition_bounce',       'in',  'create_bounce_transition',
         'transition_bounce_duration',    {'bounce_start': True}, 'bounce', 'duration'),
        ('transition_bounce',       'out', 'create_bounce_transition',
         'transition_bounce_duration',    {'bounce_start': False}, 'bounce', 'duration'),
    ]

    in_enabled = []   # [(method_name, dur, extra_kwargs, sfx_tname, dur_param, enabled_key), ...]
    out_enabled = []  # same

    for entry in _TR_SPECS:
        enabled_key = entry[0]
        if settings.get(enabled_key, False):
            _, typ, method_name, dur_key, extra, sfx_tname, dur_param = entry
            dur = float(settings.get(dur_key, 0.5))
            target = in_enabled if typ == 'in' else out_enabled
            target.append((method_name, dur, extra, sfx_tname, dur_param, enabled_key))

    if not in_enabled and not out_enabled:
        print(f"[SILENCE] No Transitions-tab effects enabled — using crossfade only")
    else:
        in_names = ', '.join(e[0].replace('create_', '').replace('_transition', '').replace('apply_', '') for e in in_enabled)
        out_names = ', '.join(e[0].replace('create_', '').replace('_transition', '').replace('apply_', '') for e in out_enabled)
        print(f"[SILENCE] Tab transitions: in=[{in_names}] out=[{out_names}] dur={transition_duration:.2f}s")

    clips = list(sub_clips)
    sfx_clips = []
    sfx_volume = float(settings.get('transition_sfx_volume', 0.6))
    sfx_enabled = settings.get('transition_sfx_enabled', True)

    # Spacing tracker: when min_interval > 0, only apply tab transitions
    # at boundaries where cumulative_time_since_last >= min_interval
    _last_tab_time = 0.0
    _cumul_time = 0.0

    for i, clip in enumerate(clips):
        apply_start = i > 0
        apply_end   = i < len(clips) - 1

        # If spacing is active, check if this boundary is far enough from last
        _skip_this_boundary = False
        if min_interval > 0 and i > 0:
            # _cumul_time is the time at the START of this clip
            if _cumul_time - _last_tab_time < min_interval:
                _skip_this_boundary = True

        if apply_start and in_enabled and not _skip_this_boundary:
            for method_name, dur, extra, sfx_tname, dur_param, enabled_key in in_enabled:
                try:
                    kwargs = {}
                    for k, v in extra.items():
                        kwargs[k] = v(settings) if callable(v) else v
                    kwargs[dur_param] = min(dur, transition_duration)
                    method = getattr(TransitionEffects, method_name)
                    clip = method(clip, **kwargs)

                    # SFX at this boundary
                    if sfx_enabled and sfx_volume > 0:
                        t_at = sum(c.duration for c in clips[:i]) - transition_duration * i
                        if t_at < 0:
                            t_at = 0
                        sfx_name, cf, cv = _resolve_sfx_for_transition(settings, enabled_key, sfx_tname)
                        if sfx_name:
                            sfx = _make_sfx_clip(
                                sfx_name, min(dur, transition_duration),
                                max(0, t_at), 44100, sfx_volume,
                                custom_file=cf, custom_volume=cv)
                            if sfx is not None:
                                sfx_clips.append(sfx)
                except Exception as e:
                    print(f'  [WARN] Segment transition {method_name} failed: {e}')

        if apply_end and out_enabled and not _skip_this_boundary:
            for method_name, dur, extra, sfx_tname, dur_param, enabled_key in out_enabled:
                try:
                    kwargs = {}
                    for k, v in extra.items():
                        kwargs[k] = v(settings) if callable(v) else v
                    kwargs[dur_param] = min(dur, transition_duration)
                    method = getattr(TransitionEffects, method_name)
                    clip = method(clip, **kwargs)
                except Exception as e:
                    print(f'  [WARN] Segment transition {method_name} failed: {e}')

        # Update tracking: if we applied a tab transition at this boundary, mark time
        if i > 0 and not _skip_this_boundary and (in_enabled or out_enabled):
            _last_tab_time = _cumul_time

        clips[i] = clip
        _cumul_time += clip.duration

    return clips, sfx_clips


def _ffmpeg_cut_concat(video_path, output_path, segments, ffmpeg, nvenc: bool, fps=None) -> bool:
    """Cut+stitch the keep-segments in ONE ffmpeg pass — the fast path.

    MoviePy renders 1080p@50-60fps at only ~6 fps even from H.264, so a plain
    silence-cut of a YouTube AV1 download can take 10+ minutes. This replaces
    the whole MoviePy render for the no-transitions case: ffmpeg decodes the
    source once and encodes once (NVENC when available) — roughly 20x faster,
    same output. Uses the interleaved ``[vN][aN]`` concat filter (same pattern
    as the Our Script length-crop).
    """
    import subprocess
    n = len(segments)
    if n == 0:
        return False
    parts = []
    for i, (s, e) in enumerate(segments):
        trim = f'trim=start_frame={round(s*fps)}:end_frame={round(e*fps)}' if fps else f'trim=start={s:.9f}:end={e:.9f}'
        parts.append(f'[0:v]{trim},'
                     f'setpts=PTS-STARTPTS[v{i}]')
        parts.append(f'[0:a]atrim=start={s:.9f}:end={e:.9f},'
                     f'asetpts=PTS-STARTPTS[a{i}]')
    concat_in = ''.join(f'[v{i}][a{i}]' for i in range(n))
    fc = ';'.join(parts) + f';{concat_in}concat=n={n}:v=1:a=1[v][a]'
    if nvenc:
        venc = ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '23']
    else:
        venc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19']
    cmd = [ffmpeg, '-v', 'error', '-y', '-i', str(video_path),
           '-filter_complex', fc,
           '-map', '[v]', '-map', '[a]'] + venc + ['-c:a', 'aac', '-b:a', '160k',
                                                   str(output_path)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    except Exception as e:
        print(f"[ERROR] remove_silence: ffmpeg cut+concat failed: {e}")
        return False
    if r.returncode != 0 or not output_path.is_file() \
            or output_path.stat().st_size == 0:
        print(f"[ERROR] remove_silence: ffmpeg cut+concat failed: "
              f"{r.stderr[-300:] if r.stderr else 'no stderr'}")
        return False
    print(f"[SILENCE] ffmpeg fast cut+concat: {n} segment(s)")
    return True
