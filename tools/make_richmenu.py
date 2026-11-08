import sys
from PIL import Image, ImageDraw, ImageFont
OUT = sys.argv[1]
W, H, TAB = 2500, 1686, 240
ACC = (10,117,83); ACC_SOFT = (225,240,233); INK = (19,32,27); MUTED = (90,107,101); BG = (246,249,248); LINE = (214,223,219); WHITE=(255,255,255)
FB = "C:/Windows/Fonts/YuGothB.ttc"; FM = "C:/Windows/Fonts/YuGothM.ttc"
f_tab = ImageFont.truetype(FB, 78); f_lab = ImageFont.truetype(FB, 92); f_sub = ImageFont.truetype(FM, 54); f_glyph = ImageFont.truetype(FB, 210)
SW = 20  # stroke width

def ctext(d, cx, y, s, font, fill):
    w = d.textlength(s, font=font); d.text((cx - w/2, y), s, font=font, fill=fill)

# ---- icons: drawn inside a box centred at (cx, cy), size ~ 240 ----
def ic_calendar(d, cx, cy, c):
    x0,y0,x1,y1 = cx-120, cy-100, cx+120, cy+120
    d.rounded_rectangle((x0,y0,x1,y1), 28, outline=c, width=SW)
    d.line((x0, y0+70, x1, y0+70), fill=c, width=SW)
    for x in (cx-60, cx+60): d.line((x, y0-30, x, y0+25), fill=c, width=SW)
    for i in range(3):
        for j in range(2):
            px, py = cx-70+i*70, y0+115+j*55
            d.rounded_rectangle((px-16,py-14,px+16,py+14), 6, fill=c)
def ic_check(d, cx, cy, c):
    d.rounded_rectangle((cx-105,cy-125,cx+105,cy+125), 24, outline=c, width=SW)
    for k,yy in enumerate((cy-55, cy+5, cy+65)):
        d.line((cx-60,yy,cx-40,yy+20), fill=c, width=SW); d.line((cx-40,yy+20,cx-8,yy-14), fill=c, width=SW)
        d.line((cx+15,yy+3,cx+65,yy+3), fill=c, width=SW)
def ic_list(d, cx, cy, c):
    for k in range(3):
        yy = cy-80+k*80
        d.ellipse((cx-115,yy-17,cx-81,yy+17), fill=c); d.line((cx-50,yy,cx+115,yy), fill=c, width=SW)
def ic_question(d, cx, cy, c):
    d.ellipse((cx-125,cy-125,cx+125,cy+125), outline=c, width=SW)
    ctext(d, cx, cy-140, "?", f_glyph, c)
def ic_chat(d, cx, cy, c):
    d.rounded_rectangle((cx-130,cy-105,cx+130,cy+75), 50, outline=c, width=SW)
    d.polygon([(cx-60,cy+68),(cx-95,cy+135),(cx-10,cy+68)], fill=c)
    for dx in (-60,0,60): d.ellipse((cx+dx-15,cy-30,cx+dx+15,cy), fill=c)
def ic_reset(d, cx, cy, c):
    d.arc((cx-115,cy-115,cx+115,cy+115), 40, 330, fill=c, width=SW)
    # arrow head at ~330deg (upper right)
    d.polygon([(cx+120,cy-110),(cx+125,cy-20),(cx+40,cy-55)], fill=c)
def ic_flow(d, cx, cy, c):
    for k,xx in enumerate((cx-95, cx+95)):
        pass
    d.rounded_rectangle((cx-130,cy-125,cx-30,cy-45), 14, outline=c, width=SW)
    d.rounded_rectangle((cx+30,cy-40,cx+130,cy+40), 14, fill=c)
    d.rounded_rectangle((cx-130,cy+45,cx-30,cy+125), 14, outline=c, width=SW)
    d.line((cx-30,cy-85,cx+80,cy-85), fill=c, width=SW); d.line((cx+80,cy-85,cx+80,cy-40), fill=c, width=SW)
    d.line((cx+80,cy+40,cx+80,cy+85), fill=c, width=SW); d.line((cx+80,cy+85,cx-30,cy+85), fill=c, width=SW)
def ic_code(d, cx, cy, c):
    d.line((cx-60,cy-90,cx-135,cy),fill=c,width=SW); d.line((cx-135,cy,cx-60,cy+90),fill=c,width=SW)
    d.line((cx+60,cy-90,cx+135,cy),fill=c,width=SW); d.line((cx+135,cy,cx+60,cy+90),fill=c,width=SW)
    d.line((cx+30,cy-115,cx-30,cy+115),fill=c,width=SW)
def ic_grid(d, cx, cy, c):
    for i in range(2):
        for j in range(2):
            x, y = cx-115+i*130, cy-115+j*130
            if i==0 and j==0: d.rounded_rectangle((x,y,x+100,y+100), 18, fill=c)
            else: d.rounded_rectangle((x,y,x+100,y+100), 18, outline=c, width=SW)
def ic_doc(d, cx, cy, c):
    d.rounded_rectangle((cx-100,cy-125,cx+100,cy+125), 20, outline=c, width=SW)
    d.rectangle((cx-60,cy-75,cx+60,cy-15), fill=c)
    for yy in (cy+25, cy+75): d.line((cx-60,yy,cx+60,yy), fill=c, width=SW)
def ic_mail(d, cx, cy, c):
    d.rounded_rectangle((cx-135,cy-95,cx+135,cy+95), 22, outline=c, width=SW)
    d.line((cx-125,cy-80,cx,cy+15),fill=c,width=SW); d.line((cx,cy+15,cx+125,cy-80),fill=c,width=SW)
def ic_back(d, cx, cy, c):
    d.line((cx-120,cy,cx+120,cy), fill=c, width=SW+4)
    d.line((cx-120,cy,cx-40,cy-80), fill=c, width=SW+4); d.line((cx-120,cy,cx-40,cy+80), fill=c, width=SW+4)

def make(active, tiles, path):
    im = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(im)
    # tabs
    for i, label in enumerate(["予約メニュー", "このBotについて"]):
        x0 = i*1250; on = (i == active)
        d.rectangle((x0, 0, x0+1250, TAB), fill=ACC if on else WHITE)
        ctext(d, x0+625, 70, label, f_tab, WHITE if on else MUTED)
    d.line((0, TAB, W, TAB), fill=ACC, width=8)
    # tiles
    rowH = (H - TAB) // 2; xs = [0, 833, 1667]; ws = [833, 834, 833]
    for k, (label, sub, icon, primary) in enumerate(tiles):
        r, c = divmod(k, 3); x0, y0 = xs[c], TAB + r*rowH
        x1, y1 = x0+ws[c], y0+rowH
        pad = 22
        box = (x0+pad, y0+pad, x1-pad, y1-pad)
        d.rounded_rectangle(box, 36, fill=ACC if primary else WHITE, outline=None if primary else LINE, width=0 if primary else 4)
        cx = (x0+x1)//2
        col = WHITE if primary else ACC
        icon(d, cx, y0+260, col)
        ctext(d, cx, y0+440, label, f_lab, WHITE if primary else INK)
        ctext(d, cx, y0+560, sub, f_sub, (205,233,221) if primary else MUTED)
    im.save(path, optimize=True)

make(0, [
    ("予約する", "空き枠から選ぶ", ic_calendar, True),
    ("予約確認", "確認・キャンセル", ic_check, False),
    ("メニュー・料金", "施術と価格", ic_list, False),
    ("よくある質問", "自動でお答え", ic_question, False),
    ("担当者に相談", "スタッフに通知", ic_chat, False),
    ("デモをリセット", "予約データを消去", ic_reset, False),
], OUT + "/main.png")
make(1, [
    ("仕組み", "システム構成", ic_flow, True),
    ("使用技術", "API・ツール", ic_code, False),
    ("機能一覧", "できること", ic_grid, False),
    ("実績を見る", "ポートフォリオ", ic_doc, False),
    ("開発の相談", "同じ仕組みを導入", ic_mail, False),
    ("戻る", "予約メニューへ", ic_back, False),
], OUT + "/info.png")
