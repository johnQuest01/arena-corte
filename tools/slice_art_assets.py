"""Slice user-provided sprite sheets into client/public/assets/art/."""
from __future__ import annotations

from collections import deque
from pathlib import Path
import shutil

from PIL import Image

SRC = Path(
    r"C:\Users\Bruno\.cursor\projects\c-Users-Bruno-game-project\assets"
)
DST = Path(r"c:\Users\Bruno\game.project\client\public\assets\art")
DST.mkdir(parents=True, exist_ok=True)
RAW = DST / "_raw"
RAW.mkdir(exist_ok=True)

FILES = {
    "pistols": SRC
    / "c__Users_Bruno_AppData_Roaming_Cursor_User_workspaceStorage_4450507c32e3c01c60c12ba956d17617_images_pixel-art-gun--semi-automatic-47871119-9489-4cd2-a6cc-ecd0b067baad.png",
    "ak47": SRC
    / "c__Users_Bruno_AppData_Roaming_Cursor_User_workspaceStorage_4450507c32e3c01c60c12ba956d17617_images_pixel-art-AK47-f9d87533-0170-493b-8245-5d919b475a3d.png",
    "m4a1": SRC
    / "c__Users_Bruno_AppData_Roaming_Cursor_User_workspaceStorage_4450507c32e3c01c60c12ba956d17617_images_m4a1-rifle-assaut-d7f0cd46-1224-4bc6-82bf-21f71918a165.png",
    "sniper": SRC
    / "c__Users_Bruno_AppData_Roaming_Cursor_User_workspaceStorage_4450507c32e3c01c60c12ba956d17617_images_pixel-art-gun-AWM-e271eae9-befc-4ffe-b7b1-5e982eeb28f8.png",
    "char_side": SRC
    / "c__Users_Bruno_AppData_Roaming_Cursor_User_workspaceStorage_4450507c32e3c01c60c12ba956d17617_images_pixellab-pixel-art-character--side-view-1784433573073-1c8ed08c-3cf9-427f-b526-ffd2279a8c01.png",
    "shotgun": SRC
    / "c__Users_Bruno_AppData_Roaming_Cursor_User_workspaceStorage_4450507c32e3c01c60c12ba956d17617_images_pixel-art-shot-gun-891260ce-e651-4737-a63a-e74f61ed1254.png",
    "m16": SRC
    / "c__Users_Bruno_AppData_Roaming_Cursor_User_workspaceStorage_4450507c32e3c01c60c12ba956d17617_images_pixel-art-gun-sprite--M16-rifle-1a34a7ee-a687-4f82-b3f2-a7a343067352.png",
    "tiles": SRC
    / "c__Users_Bruno_AppData_Roaming_Cursor_User_workspaceStorage_4450507c32e3c01c60c12ba956d17617_images_texture-33c8df80-d386-4fa4-bc4e-54f3ab720ea6.png",
    "char_dirs": SRC
    / "c__Users_Bruno_AppData_Roaming_Cursor_User_workspaceStorage_4450507c32e3c01c60c12ba956d17617_images_persno-Step-A-eb81a246-7ac5-4c16-8d98-11ee116ccd51.png",
}


def is_bg(px, thr=18):
    r, g, b, _a = px
    return r <= thr and g <= thr and b <= thr


def flood_clear_bg(im: Image.Image, thr=18) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    pix = im.load()
    visited = [[False] * h for _ in range(w)]
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or visited[x][y]:
            continue
        visited[x][y] = True
        if not is_bg(pix[x, y], thr):
            continue
        pix[x, y] = (0, 0, 0, 0)
        q.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    return im


def content_bbox(im: Image.Image, pad=1):
    a = im.split()[-1]
    bbox = a.getbbox()
    if not bbox:
        return (0, 0, im.width, im.height)
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(im.width, x1 + pad)
    y1 = min(im.height, y1 + pad)
    return (x0, y0, x1, y1)


def slice_grid(path: Path, cols: int, rows: int):
    im = Image.open(path).convert("RGBA")
    cw, ch = im.width // cols, im.height // rows
    cells = []
    for r in range(rows):
        for c in range(cols):
            cell = im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            cell = flood_clear_bg(cell)
            cells.append(cell)
    return cells, cw, ch


def fit_canvas(im: Image.Image, tw: int, th: int, anchor="center"):
    bb = content_bbox(im)
    crop = im.crop(bb)
    out = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    if crop.width == 0 or crop.height == 0:
        return out
    scale = min(tw / crop.width, th / crop.height, 1.0)
    if scale < 1:
        nw = max(1, int(crop.width * scale))
        nh = max(1, int(crop.height * scale))
        crop = crop.resize((nw, nh), Image.NEAREST)
    if anchor == "right":
        x = tw - crop.width - 1
        y = (th - crop.height) // 2
    else:
        x = (tw - crop.width) // 2
        y = (th - crop.height) // 2
    out.paste(crop, (x, y), crop)
    return out


def make_h_sheet(frames, frame=32):
    sheet = Image.new("RGBA", (frame * len(frames), frame), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        fitted = fit_canvas(f, frame, frame, anchor="center")
        sheet.paste(fitted, (i * frame, 0), fitted)
    return sheet


def main():
    for k, p in FILES.items():
        if not p.exists():
            raise SystemExit(f"missing source: {p}")
        shutil.copy2(p, RAW / f"{k}.png")
        print("raw", k, Image.open(p).size)

    pistol_cells, _, _ = slice_grid(FILES["pistols"], 4, 4)
    ak_cells, _, _ = slice_grid(FILES["ak47"], 2, 2)
    m4_cells, _, _ = slice_grid(FILES["m4a1"], 2, 2)
    m16_cells, _, _ = slice_grid(FILES["m16"], 2, 2)
    sg_cells, _, _ = slice_grid(FILES["shotgun"], 2, 2)
    sn_cells, _, _ = slice_grid(FILES["sniper"], 2, 2)

    guns = {
        "gun_pistol.png": pistol_cells[0],
        "gun_smg.png": pistol_cells[3],
        "gun_ak47.png": ak_cells[3],
        "gun_m4a1.png": m4_cells[0],
        "gun_m16.png": m16_cells[0],
        "gun_shotgun.png": sg_cells[0],
        "gun_sniper.png": sn_cells[0],
    }
    for name, cell in guns.items():
        out = fit_canvas(cell, 48, 24, anchor="right")
        out.save(DST / name)
        print("gun", name, "opaque", sum(out.split()[-1].histogram()[1:]))

    char_cells, _, _ = slice_grid(FILES["char_side"], 4, 4)
    idle_frames = [char_cells[12], char_cells[13]]
    walk_frames = char_cells[4:8] + char_cells[8:10]
    death_frames = [char_cells[15], char_cells[14], char_cells[13], char_cells[12]]

    idle_sheet = make_h_sheet(idle_frames, 32)
    walk_sheet = make_h_sheet(walk_frames, 32)
    death_sheet = make_h_sheet(death_frames, 32)
    idle_sheet.save(DST / "char0_idle.png")
    walk_sheet.save(DST / "char0_walk.png")
    death_sheet.save(DST / "char0_death.png")
    print("char", idle_sheet.size, walk_sheet.size, death_sheet.size)

    shutil.copy2(FILES["char_dirs"], DST / "char0_dirs8.png")
    shutil.copy2(FILES["char_side"], DST / "char0_side_sheet.png")

    tim = Image.open(FILES["tiles"]).convert("RGBA")
    candidates = []
    for r in range(8):
        for c in range(8):
            cell = tim.crop((c * 32, r * 32, (c + 1) * 32, (r + 1) * 32))
            px = list(cell.getdata())
            nonblack = [p for p in px if not (p[0] < 20 and p[1] < 20 and p[2] < 20)]
            if len(nonblack) < 200:
                continue
            sandish = sum(1 for p in nonblack if p[0] > 140 and p[1] > 100 and p[2] < 120)
            if sandish > 120:
                candidates.append((sandish, cell, r, c))
    candidates.sort(reverse=True, key=lambda x: x[0])
    print("sand candidates", [(s, r, c) for s, _, r, c in candidates[:8]])
    for i, name in enumerate(["tile_sand_a.png", "tile_sand_b.png", "tile_sand_c.png"]):
        if i < len(candidates):
            candidates[i][1].save(DST / name)
            print("tile", name, "from", candidates[i][2], candidates[i][3])
        elif candidates:
            candidates[0][1].save(DST / name)

    tim.save(DST / "tileset_desert_raw.png")
    print("DONE", sorted(p.name for p in DST.glob("*.png")))


if __name__ == "__main__":
    main()
