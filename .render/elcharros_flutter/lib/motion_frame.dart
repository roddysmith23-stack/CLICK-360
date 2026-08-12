import 'dart:math' as math;
import 'dart:ui' as ui;
import 'package:flutter/material.dart';

const double designW = 1920;
const double designH = 1080;
const int totalFrames = 390;

const Color brandRed = Color(0xFFE10600);
const Color brandGreen = Color(0xFF00843D);
const Color brandGold = Color(0xFFFFB400);
const Color brandDeepRed = Color(0xFFC90000);

const List<String> motionAssets = <String>[
  'taco_hero','taco_lime','taco_tortilla',
  'taco_beef_band_1','taco_beef_band_2','taco_beef_band_3',
  'marg_hero','marg_splash_core','marg_pair_1','marg_pair_2',
  'fajita_skillethero','fajita_piece_1','fajita_piece_2','fajita_piece_3','fajita_piece_5','fajita_piece_6','fajita_piece_7',
  'churros_hero','churro_1','churro_2','churro_3',
];

double _clamp(double v) => v.clamp(0.0, 1.0).toDouble();
double seg(int f, double a, double b) => _clamp((f - a) / (b - a));
double easeInOutCubic(double t) => t < .5 ? 4 * t * t * t : 1 - math.pow(-2 * t + 2, 3).toDouble() / 2;
double easeOutCubic(double t) => 1 - math.pow(1 - t, 3).toDouble();
double easeOutBack(double t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * math.pow(t - 1, 3).toDouble() + c1 * math.pow(t - 1, 2).toDouble();
}
double lerp(double a, double b, double t) => a + (b - a) * t;

Color _bg(int f) {
  if (f < 36) return brandRed;
  if (f < 78) return Color.lerp(brandRed, brandGreen, easeInOutCubic(seg(f, 36, 78)))!;
  if (f < 124) return brandGreen;
  if (f < 174) return Color.lerp(brandGreen, brandGold, easeInOutCubic(seg(f, 124, 174)))!;
  if (f < 198) return brandGold;
  if (f < 238) return Color.lerp(brandGold, brandRed, easeInOutCubic(seg(f, 198, 238)))!;
  if (f < 296) return brandRed;
  if (f < 324) return Color.lerp(brandRed, brandGold, easeInOutCubic(seg(f, 296, 324)))!;
  if (f < 360) return brandGold;
  return Color.lerp(brandGold, brandDeepRed, easeInOutCubic(seg(f, 360, 389)))!;
}

class MotionFrame extends StatelessWidget {
  final int frameIndex;
  const MotionFrame({super.key, required this.frameIndex});

  Widget _asset(
    String name, {
    required double x,
    required double y,
    required double w,
    double rotation = 0,
    double opacity = 1,
    double blur = 0,
    double scale = 1,
  }) {
    if (opacity <= 0.001 || w <= 1) return const SizedBox.shrink();
    Widget child = Image.asset(
      'assets/$name.webp',
      width: w,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.high,
      gaplessPlayback: true,
    );
    if (blur > 0.01) {
      child = ImageFiltered(
        imageFilter: ui.ImageFilter.blur(sigmaX: blur, sigmaY: blur),
        child: child,
      );
    }
    child = Opacity(opacity: opacity.clamp(0.0, 1.0).toDouble(), child: child);
    child = Transform.rotate(angle: rotation, alignment: Alignment.center, child: child);
    child = Transform.scale(scale: scale, alignment: Alignment.center, child: child);
    return Positioned(left: x, top: y, child: child);
  }

  double _explode(int f, int delay) {
    final out = easeInOutCubic(seg(f, 44 + delay, 69 + delay));
    final back = easeInOutCubic(seg(f, 79 + delay * .35, 101));
    return _clamp(out * (1 - back));
  }

  List<Widget> _taco(int f) {
    final children = <Widget>[];
    final enter = easeOutBack(seg(f, 0, 24));
    final heroFadeOut = 1 - easeInOutCubic(seg(f, 37, 49));
    final heroReturn = easeInOutCubic(seg(f, 91, 104));
    final heroOpacity = math.max(heroFadeOut, heroReturn).clamp(0.0, 1.0).toDouble();
    final heroX = lerp(-520, 470, enter);
    final heroY = 150 + 12 * math.sin(f * .09);
    final heroRot = lerp(-.11, .035, enter) + .015 * math.sin(f * .055);
    children.add(_asset('taco_hero', x: heroX, y: heroY, w: 980, rotation: heroRot, opacity: heroOpacity, scale: lerp(.83, 1, enter)));

    final wipe = easeInOutCubic(seg(f, 34, 50));
    if (wipe > 0 && wipe < 1) {
      children.add(_asset('taco_lime', x: lerp(1730, -690, wipe), y: lerp(65, 260, wipe), w: lerp(380, 920, wipe), rotation: lerp(-.7, 1.1, wipe), blur: 1 + 5 * wipe));
    }

    final compOpacity = easeInOutCubic(seg(f, 42, 51)) * (1 - easeInOutCubic(seg(f, 96, 105)));
    final tortillaP = _explode(f, 0);
    children.add(_asset('taco_tortilla', x: lerp(645, 500, tortillaP), y: lerp(568, 716, tortillaP), w: lerp(690, 930, tortillaP), rotation: lerp(.01, -.025, tortillaP), opacity: compOpacity));

    const beefNames = ['taco_beef_band_1','taco_beef_band_2','taco_beef_band_3'];
    const beefX = [555.0, 780.0, 1035.0];
    for (var i = 0; i < beefNames.length; i++) {
      final p = _explode(f, 2 + i * 2);
      children.add(_asset(beefNames[i], x: lerp(760 + i * 50, beefX[i], p), y: lerp(545, 545 + (i == 1 ? -8 : 6), p), w: lerp(260, 390, p), rotation: lerp(.03 * (i - 1), .025 * (i - 1), p), opacity: compOpacity));
    }

    final garnishOpacity = compOpacity;
    if (garnishOpacity > .001) {
      children.add(Positioned.fill(child: IgnorePointer(child: CustomPaint(painter: TacoGarnishPainter(f, garnishOpacity)))));
    }

    final lp = _explode(f, 13);
    children.add(_asset('taco_lime', x: lerp(860, 760, lp), y: lerp(455, 150, lp), w: lerp(180, 390, lp), rotation: lerp(.25, -.12, lp), opacity: compOpacity));
    return children;
  }

  List<Widget> _margarita(int f) {
    final children = <Widget>[];
    final enter = easeOutBack(seg(f, 92, 116));
    final heroFade = 1 - easeInOutCubic(seg(f, 119, 133));
    final heroOpacity = enter * heroFade;
    children.add(_asset('marg_hero', x: lerp(730, 650, enter), y: lerp(880, 105, enter), w: 625, rotation: lerp(.08, -.02, enter), opacity: heroOpacity));

    final splashIn = easeInOutCubic(seg(f, 118, 136));
    final splashOut = 1 - easeInOutCubic(seg(f, 155, 172));
    final splashOpacity = splashIn * splashOut;
    children.add(_asset('marg_splash_core', x: 560, y: 130, w: 790, rotation: -.03 + .025 * math.sin(f * .08), opacity: splashOpacity, scale: lerp(.88, 1.03, splashIn)));

    if (splashOpacity > .001) {
      children.add(Positioned.fill(child: IgnorePointer(child: CustomPaint(painter: MargaritaParticlePainter(f, splashOpacity)))));
      final lp1 = easeOutCubic(seg(f, 123, 150)) * (1 - easeInOutCubic(seg(f, 158, 174)));
      final lp2 = easeOutCubic(seg(f, 128, 153)) * (1 - easeInOutCubic(seg(f, 158, 174)));
      children.add(_asset('taco_lime', x: lerp(850, 390, lp1), y: lerp(420, 170, lp1), w: lerp(150, 280, lp1), rotation: lerp(.1, -.6, lp1), opacity: splashOpacity));
      children.add(_asset('taco_lime', x: lerp(860, 1280, lp2), y: lerp(430, 260, lp2), w: lerp(140, 250, lp2), rotation: lerp(-.1, .75, lp2), opacity: splashOpacity));
    }

    final pairIn = easeOutBack(seg(f, 160, 181));
    final pairOut = 1 - easeInOutCubic(seg(f, 190, 202));
    children.add(_asset('marg_pair_1', x: lerp(570, 335, pairIn), y: lerp(600, 210, pairIn), w: 610, rotation: lerp(-.06, .025, pairIn), opacity: pairIn * pairOut));
    children.add(_asset('marg_pair_2', x: lerp(830, 995, pairIn), y: lerp(600, 185, pairIn), w: 600, rotation: lerp(.07, -.025, pairIn), opacity: pairIn * pairOut));

    final wipe = easeInOutCubic(seg(f, 186, 202));
    if (wipe > 0 && wipe < 1) {
      children.add(_asset('taco_lime', x: lerp(1640, -600, wipe), y: lerp(80, 390, wipe), w: lerp(300, 850, wipe), rotation: lerp(-.4, 1.25, wipe), blur: 1 + 7 * wipe));
    }
    return children;
  }

  List<Widget> _fajita(int f) {
    final children = <Widget>[];
    final skilletIn = easeOutBack(seg(f, 190, 214));
    final skilletOut = 1 - easeInOutCubic(seg(f, 288, 302));
    final skilletY = lerp(1010, 650, skilletIn);
    children.add(_asset('fajita_skillethero', x: 235, y: skilletY, w: 1450, rotation: -.01, opacity: skilletIn * skilletOut, scale: 1 + .018 * math.sin((f - 205) * .06) * skilletIn));

    const names = ['fajita_piece_1','fajita_piece_2','fajita_piece_3','fajita_piece_5','fajita_piece_6','fajita_piece_7'];
    const tx = [430.0, 650.0, 900.0, 520.0, 820.0, 1120.0];
    const ty = [350.0, 315.0, 350.0, 475.0, 445.0, 475.0];
    const tw = [300.0, 300.0, 310.0, 355.0, 355.0, 350.0];
    const rot0 = [-1.0,.8,-.7,.55,-.65,.85];
    for (var i = 0; i < names.length; i++) {
      final land = easeOutBack(seg(f, 202 + i * 5, 234 + i * 5));
      final out = 1 - easeInOutCubic(seg(f, 286, 301));
      final drift = math.sin((f + i * 17) * .055) * 5 * land;
      children.add(_asset(
        names[i],
        x: lerp(tx[i] + (i.isEven ? -210 : 190), tx[i], land),
        y: lerp(-360 - i * 45, ty[i] + drift, land),
        w: tw[i],
        rotation: lerp(rot0[i], .02 * (i - 3.5), land),
        opacity: land * out,
        blur: lerp(4, 0, land),
      ));
    }

    final steam = easeInOutCubic(seg(f, 222, 244)) * (1 - easeInOutCubic(seg(f, 284, 300)));
    if (steam > .001) {
      children.add(Positioned.fill(child: IgnorePointer(child: CustomPaint(painter: SteamPainter(steam, f)))));
    }
    final wipe = easeInOutCubic(seg(f, 286, 301));
    if (wipe > 0 && wipe < 1) {
      children.add(_asset('fajita_piece_3', x: lerp(1640, -520, wipe), y: lerp(180, 430, wipe), w: lerp(320, 850, wipe), rotation: lerp(-.8, 1.15, wipe), blur: 1 + 6 * wipe));
    }
    return children;
  }

  List<Widget> _churros(int f) {
    final children = <Widget>[];
    const names = ['churro_1','churro_2','churro_3'];
    const sx = [-720.0, 2020.0, 760.0];
    const sy = [220.0, 200.0, -520.0];
    const tx = [350.0, 670.0, 900.0];
    const ty = [250.0, 330.0, 230.0];
    const tw = [830.0, 830.0, 760.0];
    const sr = [-.8,.7,1.2];
    const tr = [-.38,.10,.46];
    final individualOut = 1 - easeInOutCubic(seg(f, 338, 353));
    for (var i = 0; i < names.length; i++) {
      final e = easeOutBack(seg(f, 290 + i * 5, 320 + i * 4));
      children.add(_asset(names[i], x: lerp(sx[i], tx[i], e), y: lerp(sy[i], ty[i], e), w: tw[i], rotation: lerp(sr[i], tr[i], e), opacity: e * individualOut, blur: lerp(4, 0, e)));
    }

    final chocolate = easeInOutCubic(seg(f, 300, 330)) * (1 - easeInOutCubic(seg(f, 345, 358)));
    if (chocolate > .001) {
      children.insert(0, Positioned.fill(child: IgnorePointer(child: CustomPaint(painter: ChocolatePainter(chocolate, f)))));
    }
    final sugar = easeInOutCubic(seg(f, 302, 326)) * (1 - easeInOutCubic(seg(f, 348, 360)));
    if (sugar > .001) {
      children.add(Positioned.fill(child: IgnorePointer(child: CustomPaint(painter: SugarPainter(sugar, f)))));
    }

    final heroIn = easeInOutCubic(seg(f, 334, 350));
    final heroOut = 1 - easeInOutCubic(seg(f, 351, 370));
    children.add(_asset('churros_hero', x: lerp(440, 355, heroIn), y: lerp(230, 130, heroIn) - 120 * easeInOutCubic(seg(f, 352, 370)), w: 1210, rotation: -.02, opacity: heroIn * heroOut, scale: lerp(.93, 1.02, heroIn)));
    return children;
  }

  List<Widget> _closing(int f) {
    final children = <Widget>[];
    final p = easeInOutCubic(seg(f, 360, 389));
    final drift = 1 - p;
    children.add(_asset('taco_lime', x: lerp(210, -280, p), y: lerp(720, 840, p), w: 250, rotation: lerp(.2, -1.1, p), opacity: .55 * drift, blur: 1.5 * p));
    return children;
  }

  @override
  Widget build(BuildContext context) {
    final int f = frameIndex.clamp(0, totalFrames - 1).toInt();
    final children = <Widget>[Positioned.fill(child: ColoredBox(color: _bg(f)))];
    if (f <= 108) children.addAll(_taco(f));
    if (f >= 88 && f <= 205) children.addAll(_margarita(f));
    if (f >= 184 && f <= 304) children.addAll(_fajita(f));
    if (f >= 282 && f <= 372) children.addAll(_churros(f));
    if (f >= 356) children.addAll(_closing(f));

    final camScale = 1.0 + .006 * math.sin(f * .027);
    final camX = 3.5 * math.sin(f * .021);
    final camY = 2.5 * math.cos(f * .024);
    return SizedBox(
      width: designW,
      height: designH,
      child: ClipRect(
        child: Transform.translate(
          offset: Offset(camX, camY),
          child: Transform.scale(
            scale: camScale,
            child: Stack(clipBehavior: Clip.none, children: children),
          ),
        ),
      ),
    );
  }
}

class TacoGarnishPainter extends CustomPainter {
  final int frame;
  final double opacity;
  TacoGarnishPainter(this.frame, this.opacity);

  double _pieceP(int i) {
    final out = easeInOutCubic(seg(frame, 48 + i * 1.2, 70 + i * 1.2));
    final back = easeInOutCubic(seg(frame, 80 + i * .4, 100));
    return _clamp(out * (1 - back));
  }

  @override
  void paint(Canvas canvas, Size size) {
    const onionTargets = <Offset>[
      Offset(610,445),Offset(720,430),Offset(830,450),Offset(940,425),Offset(1050,448),Offset(1160,432),Offset(1260,452),
    ];
    const cilantroTargets = <Offset>[
      Offset(620,345),Offset(760,320),Offset(900,352),Offset(1040,318),Offset(1180,350),
    ];
    final onionPaint = Paint()..color = Colors.white.withOpacity(.93 * opacity);
    final onionEdge = Paint()..style=PaintingStyle.stroke..strokeWidth=2..color=const Color(0xFFE8F0EF).withOpacity(.85*opacity);
    for (var i=0;i<onionTargets.length;i++) {
      final p=_pieceP(i);
      final c=Offset(875 + (i-3)*18.0, 515);
      final t=onionTargets[i];
      final pos=Offset(lerp(c.dx,t.dx,p),lerp(c.dy,t.dy,p));
      canvas.save();
      canvas.translate(pos.dx,pos.dy);
      canvas.rotate(lerp(.12*(i-3),.02*(i-3),p));
      final r=Rect.fromCenter(center:Offset.zero,width:34+4*(i%2),height:30+3*((i+1)%2));
      canvas.drawRRect(RRect.fromRectAndRadius(r,const Radius.circular(5)),onionPaint);
      canvas.drawRRect(RRect.fromRectAndRadius(r,const Radius.circular(5)),onionEdge);
      canvas.restore();
    }
    final leafPaint=Paint()..color=const Color(0xFF39A845).withOpacity(.98*opacity);
    final stemPaint=Paint()..color=const Color(0xFF287F32).withOpacity(.95*opacity)..strokeWidth=4..style=PaintingStyle.stroke..strokeCap=StrokeCap.round;
    for (var i=0;i<cilantroTargets.length;i++) {
      final p=_pieceP(7+i);
      final c=Offset(890 + (i-2)*22.0, 500);
      final t=cilantroTargets[i];
      final pos=Offset(lerp(c.dx,t.dx,p),lerp(c.dy,t.dy,p));
      canvas.save(); canvas.translate(pos.dx,pos.dy); canvas.rotate(lerp(-.5+i*.18,-.12+i*.06,p));
      canvas.drawLine(const Offset(0,16),const Offset(0,-8),stemPaint);
      for (var k=0;k<5;k++) {
        final a=(-1.9 + k*.95);
        final o=Offset(math.cos(a)*18, -8+math.sin(a)*12);
        canvas.drawOval(Rect.fromCenter(center:o,width:23,height:16),leafPaint);
      }
      canvas.restore();
    }
  }
  @override bool shouldRepaint(covariant TacoGarnishPainter oldDelegate)=>true;
}

class MargaritaParticlePainter extends CustomPainter {
  final int frame;
  final double opacity;
  MargaritaParticlePainter(this.frame,this.opacity);
  @override
  void paint(Canvas canvas, Size size) {
    const targets=<Offset>[
      Offset(510,180),Offset(720,100),Offset(940,155),Offset(1180,140),Offset(1320,380),Offset(520,570),Offset(1190,620),
    ];
    for (var i=0;i<targets.length;i++) {
      final p=easeOutCubic(seg(frame,122+i*2,148+i*2))*(1-easeInOutCubic(seg(frame,158,175)));
      final c=const Offset(900,440); final t=targets[i];
      final pos=Offset(lerp(c.dx,t.dx,p),lerp(c.dy,t.dy,p));
      canvas.save(); canvas.translate(pos.dx,pos.dy); canvas.rotate(lerp(0,.65*(i.isEven?1:-1),p));
      final s=lerp(22,58+(i%3)*8,p);
      final fill=Paint()..color=Colors.white.withOpacity(.18*opacity)..style=PaintingStyle.fill;
      final edge=Paint()..color=Colors.white.withOpacity(.74*opacity)..style=PaintingStyle.stroke..strokeWidth=4;
      final r=RRect.fromRectAndRadius(Rect.fromCenter(center:Offset.zero,width:s,height:s),Radius.circular(s*.12));
      canvas.drawRRect(r,fill); canvas.drawRRect(r,edge);
      canvas.drawLine(Offset(-s*.25,-s*.25),Offset(s*.28,s*.28),edge..strokeWidth=2);
      canvas.restore();
    }
    final drop=Paint()..color=const Color(0xFFFFFFE8).withOpacity(.42*opacity);
    for (var i=0;i<32;i++) {
      final a=i*.73+frame*.025; final rr=120+(i%7)*36.0; final cx=900+math.cos(a)*rr; final cy=420+math.sin(a)*rr*.55;
      canvas.drawCircle(Offset(cx,cy),2.5+(i%3),drop);
    }
  }
  @override bool shouldRepaint(covariant MargaritaParticlePainter oldDelegate)=>true;
}

class SteamPainter extends CustomPainter {
  final double strength;
  final int frame;
  SteamPainter(this.strength, this.frame);
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 9
      ..color = Colors.white.withOpacity(.13 * strength)
      ..maskFilter = const ui.MaskFilter.blur(BlurStyle.normal, 13);
    for (var i = 0; i < 7; i++) {
      final x = 500 + i * 145 + 22 * math.sin(frame * .04 + i);
      final y = 700 - 18 * math.sin(frame * .05 + i * .7);
      final path = Path()..moveTo(x, y);
      path.cubicTo(x - 55, y - 80, x + 70, y - 155, x + 10, y - 255);
      canvas.drawPath(path, p);
    }
  }
  @override bool shouldRepaint(covariant SteamPainter oldDelegate) => true;
}

class ChocolatePainter extends CustomPainter {
  final double strength;
  final int frame;
  ChocolatePainter(this.strength, this.frame);
  @override
  void paint(Canvas canvas, Size size) {
    final wiggle = math.sin(frame * .08) * 28;
    final dark = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 24
      ..color = const Color(0xFF3B160B).withOpacity(.86 * strength)
      ..maskFilter = const ui.MaskFilter.blur(BlurStyle.normal, 1.2);
    final caramel = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 14
      ..color = const Color(0xFF9A4E13).withOpacity(.82 * strength);
    final p1 = Path()..moveTo(260, 720);
    p1.cubicTo(480, 420 + wiggle, 760, 710 - wiggle, 980, 390);
    p1.cubicTo(1190, 80 + wiggle, 1450, 470, 1680, 280);
    canvas.drawPath(p1, dark);
    final p2 = Path()..moveTo(240, 350);
    p2.cubicTo(490, 640 - wiggle, 840, 220 + wiggle, 1110, 580);
    p2.cubicTo(1350, 880 - wiggle, 1500, 520, 1710, 710);
    canvas.drawPath(p2, caramel);
  }
  @override bool shouldRepaint(covariant ChocolatePainter oldDelegate) => true;
}

class SugarPainter extends CustomPainter {
  final double strength;
  final int frame;
  SugarPainter(this.strength, this.frame);
  @override
  void paint(Canvas canvas, Size size) {
    final random = math.Random(731);
    final p = Paint()..color = Colors.white.withOpacity(.5 * strength);
    for (var i = 0; i < 95; i++) {
      final x0 = 280 + random.nextDouble() * 1360;
      final y0 = 150 + random.nextDouble() * 750;
      final vy = (random.nextDouble() - .5) * 90;
      final x = x0 + math.sin(frame * .04 + i) * 9;
      final y = y0 + vy * strength + math.cos(frame * .035 + i) * 7;
      final r = 1.2 + random.nextDouble() * 3.1;
      canvas.drawCircle(Offset(x, y), r, p);
    }
  }
  @override bool shouldRepaint(covariant SugarPainter oldDelegate) => true;
}
