from PIL import Image,ImageDraw
W=1024
TOP=(200,200,205,255);FRONT=(110,110,118,255);LINE=(40,40,48,255);GRID=(150,150,160,255)
def box(dr,x0,y0,cw,ch,fh,top=TOP,front=FRONT):
    dr.rectangle([x0,y0,x0+cw,y0+ch],fill=top,outline=LINE,width=4)
    dr.rectangle([x0,y0+ch,x0+cw,y0+ch+fh],fill=front,outline=LINE,width=4)
# 1) camera guide: 4x4 ground grid + a block + a tall tower block
im=Image.new('RGBA',(W,W),(0,0,0,0));dr=ImageDraw.Draw(im)
cw=200;ch=round(cw*11/16)  # 138
ox=(W-4*cw)//2;oy=150
for r in range(4):
    for c in range(4):
        dr.rectangle([ox+c*cw,oy+r*ch,ox+(c+1)*cw,oy+(r+1)*ch],fill=(225,232,225,255),outline=GRID,width=3)
dr.rectangle([ox,oy+4*ch,ox+4*cw,oy+4*ch+90],fill=FRONT,outline=LINE,width=4)  # island front cliff face
# a 1x1 block on cell (1,1)
box(dr,ox+cw,oy+ch-80,cw,ch,80)
# a tall 1x1 tower on cell (2,2): top rect raised, long front face
box(dr,ox+2*cw+30,oy+2*ch-220+20,cw-60,ch-40,220)
im.save('guides/00_camera_guide.png')
# 2) bridge tiles: one cell, top 16x11 + front 7 (from original 16x18)
def tile(name,planks):
    im=Image.new('RGBA',(W,W),(0,0,0,0));dr=ImageDraw.Draw(im)
    cw=640;ch=round(cw*13/16);fh=round(cw*3/16)
    x0=(W-cw)//2;y0=(W-ch-fh)//2
    box(dr,x0,y0,cw,ch,fh)
    if planks=='h':   # bridge runs left-right: planks across = vertical seams
        for i in range(1,6): x=x0+i*cw//6; dr.line([x,y0,x,y0+ch],fill=LINE,width=3)
    else:             # bridge runs up-down: horizontal seams
        for i in range(1,5): y=y0+i*ch//5; dr.line([x0,y,x0+cw,y],fill=LINE,width=3)
    im.save(f'guides/{name}.png')
tile('01_bridge_tile_horizontal','h'); tile('02_bridge_tile_vertical','v')
# 3) preview: 5 horizontal tiles in a row to show how they join
im=Image.new('RGBA',(W,400),(0,0,0,0));dr=ImageDraw.Draw(im)
cw=180;ch=round(cw*13/16);fh=round(cw*3/16)
for i in range(5): box(dr,62+i*cw,120,cw,ch,fh)
im.save('guides/03_bridge_row_preview.png')
