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

double clamp01(double v) => v.clamp(0.0, 1.0).toDouble();
double seg(int f, double a, double b) => clamp01((f-a)/(b-a));
double lerpD(double a,double b,double t)=>a+(b-a)*t;
double ease(double t)=>t<.5?4*t*t*t:1-math.pow(-2*t+2,3).toDouble()/2;
double outCubic(double t)=>1-math.pow(1-t,3).toDouble();
double outBack(double t){const c1=1.70158,c3=c1+1;return 1+c3*math.pow(t-1,3).toDouble()+c1*math.pow(t-1,2).toDouble();}
Color bgColor(int f){
 if(f<36)return brandRed;
 if(f<78)return Color.lerp(brandRed,brandGreen,ease(seg(f,36,78)))!;
 if(f<124)return brandGreen;
 if(f<174)return Color.lerp(brandGreen,brandGold,ease(seg(f,124,174)))!;
 if(f<198)return brandGold;
 if(f<238)return Color.lerp(brandGold,brandRed,ease(seg(f,198,238)))!;
 if(f<296)return brandRed;
 if(f<324)return Color.lerp(brandRed,brandGold,ease(seg(f,296,324)))!;
 if(f<360)return brandGold;
 return Color.lerp(brandGold,brandDeepRed,ease(seg(f,360,389)))!;
}

class MotionFrame extends StatelessWidget {
 final int frameIndex;
 const MotionFrame({super.key,required this.frameIndex});
 @override Widget build(BuildContext context)=>CustomPaint(size:const Size(designW,designH),painter:FoodMotionPainter(frameIndex));
}

class FoodMotionPainter extends CustomPainter{
 final int f;
 FoodMotionPainter(this.f);
 final math.Random rng=math.Random(360);
 @override void paint(Canvas c,Size s){
   c.drawRect(Offset.zero&s,Paint()..color=bgColor(f));
   c.save();
   final pulse=1+.006*math.sin(f*.027); final cx=s.width/2,cy=s.height/2;
   c.translate(cx+3.5*math.sin(f*.021),cy+2.5*math.cos(f*.024));c.scale(pulse);c.translate(-cx,-cy);
   if(f<=110) drawTaco(c);
   if(f>=88&&f<=205) drawMargarita(c);
   if(f>=184&&f<=305) drawFajita(c);
   if(f>=282&&f<=372) drawChurros(c);
   if(f>=356) drawClose(c);
   c.restore();
 }

 Paint shadow(double a,[double blur=24])=>Paint()..color=Colors.black.withOpacity(a)..maskFilter=ui.MaskFilter.blur(BlurStyle.normal,blur);

 void lime(Canvas c,Offset p,double r,double rot,double alpha){
   c.save();c.translate(p.dx,p.dy);c.rotate(rot);
   final path=Path()..moveTo(-r,0)..quadraticBezierTo(0,r*.82,r,0)..quadraticBezierTo(0,r*.22,-r,0)..close();
   c.drawPath(path,Paint()..shader=ui.Gradient.linear(Offset(-r,0),Offset(r,0),[const Color(0xFF126B2B).withOpacity(alpha),const Color(0xFF69B73A).withOpacity(alpha)]));
   final inner=Path()..moveTo(-r*.82,-2)..quadraticBezierTo(0,r*.63,r*.82,-2)..quadraticBezierTo(0,r*.15,-r*.82,-2)..close();
   c.drawPath(inner,Paint()..color=const Color(0xFFE3F35F).withOpacity(alpha));
   for(int i=1;i<6;i++){final x=-r*.7+i*(r*1.4/6);c.drawLine(Offset(0,1),Offset(x,r*.5),Paint()..color=Colors.white.withOpacity(.34*alpha)..strokeWidth=2);}
   c.restore();
 }

 void cilantro(Canvas c,Offset p,double sc,double rot,double alpha){
   c.save();c.translate(p.dx,p.dy);c.rotate(rot);c.scale(sc);
   final stem=Paint()..color=const Color(0xFF187A2C).withOpacity(alpha)..strokeWidth=4..strokeCap=StrokeCap.round;
   c.drawLine(const Offset(0,14),const Offset(0,-8),stem);
   final leaf=Paint()..shader=ui.Gradient.radial(const Offset(0,-10),30,[const Color(0xFF6ACF4B).withOpacity(alpha),const Color(0xFF168B35).withOpacity(alpha)]);
   for(int k=0;k<5;k++){final a=-2.5+k*.78;final o=Offset(math.cos(a)*18,-9+math.sin(a)*11);c.drawOval(Rect.fromCenter(center:o,width:25,height:17),leaf);}
   c.restore();
 }

 void onion(Canvas c,Offset p,double sc,double rot,double alpha){
   c.save();c.translate(p.dx,p.dy);c.rotate(rot);c.scale(sc);
   final r=RRect.fromRectAndRadius(Rect.fromCenter(center:Offset.zero,width:34,height:30),const Radius.circular(5));
   c.drawRRect(r,Paint()..shader=ui.Gradient.linear(const Offset(-17,-15),const Offset(17,15),[Colors.white.withOpacity(.97*alpha),const Color(0xFFE7ECE8).withOpacity(.88*alpha)]));
   c.drawRRect(r,Paint()..style=PaintingStyle.stroke..strokeWidth=1.5..color=Colors.white.withOpacity(.7*alpha));c.restore();
 }

 Path tacoShellPath(double w,double h){
   return Path()..moveTo(-w*.5,h*.18)..quadraticBezierTo(-w*.37,-h*.58,0,-h*.57)..quadraticBezierTo(w*.38,-h*.56,w*.5,h*.18)..quadraticBezierTo(w*.25,h*.02,0,h*.04)..quadraticBezierTo(-w*.25,h*.02,-w*.5,h*.18)..close();
 }
 void tacoShell(Canvas c,Offset p,double w,double h,double rot,double alpha){
   c.save();c.translate(p.dx,p.dy);c.rotate(rot);
   c.drawOval(Rect.fromCenter(center:Offset(0,h*.29),width:w*.88,height:h*.18),shadow(.18*alpha,18));
   final path=tacoShellPath(w,h);
   c.drawPath(path,Paint()..shader=ui.Gradient.linear(Offset(-w*.5,-h*.4),Offset(w*.5,h*.3),[const Color(0xFFFFD053).withOpacity(alpha),const Color(0xFFE38D0B).withOpacity(alpha),const Color(0xFFFFB928).withOpacity(alpha)]));
   c.drawPath(path,Paint()..style=PaintingStyle.stroke..strokeWidth=6..color=const Color(0xFFD37B05).withOpacity(.65*alpha));
   final freckles=Paint()..color=const Color(0xFF8D4300).withOpacity(.24*alpha);
   final rr=math.Random(81);for(int i=0;i<40;i++){final x=(rr.nextDouble()-.5)*w*.78;final y=-h*.36+rr.nextDouble()*h*.45;c.drawCircle(Offset(x,y),1+rr.nextDouble()*2,freckles);}
   c.restore();
 }

 void beefFiber(Canvas c,Offset p,double len,double thick,double rot,double alpha,[Color base=const Color(0xFF7A2B12)]){
   c.save();c.translate(p.dx,p.dy);c.rotate(rot);
   final path=Path()..moveTo(-len/2,0)..cubicTo(-len*.2,-thick*.45,len*.18,thick*.38,len/2,0);
   c.drawPath(path,Paint()..color=Colors.black.withOpacity(.16*alpha)..strokeWidth=thick+9..strokeCap=StrokeCap.round..maskFilter=const ui.MaskFilter.blur(BlurStyle.normal,5));
   c.drawPath(path,Paint()..shader=ui.Gradient.linear(Offset(-len/2,0),Offset(len/2,0),[const Color(0xFF4F170D).withOpacity(alpha),base.withOpacity(alpha),const Color(0xFFD05B1A).withOpacity(alpha)])..strokeWidth=thick..strokeCap=StrokeCap.round);
   c.drawPath(path,Paint()..color=const Color(0xFFFFA047).withOpacity(.24*alpha)..strokeWidth=math.max(2.0,thick*.13)..strokeCap=StrokeCap.round);
   c.restore();
 }

 double explode(int delay){final out=ease(seg(f,44+delay,70+delay));final back=ease(seg(f,80+delay*.35,102));return clamp01(out*(1-back));}
 void drawTaco(Canvas c){
   final enter=outBack(seg(f,0,24)); final heroOut=1-ease(seg(f,38,50)); final heroReturn=ease(seg(f,91,105)); final heroA=math.max(heroOut,heroReturn).clamp(0.0,1.0).toDouble();
   final hp=Offset(lerpD(-510,870,enter),545+12*math.sin(f*.09));
   if(heroA>.01){c.save();c.translate(hp.dx,hp.dy);c.rotate(lerpD(-.12,.035,enter));c.scale(lerpD(.82,1,enter));
     tacoShell(c,const Offset(0,55),850,500,0,heroA);
     for(int i=0;i<30;i++){final rr=math.Random(900+i);final x=(rr.nextDouble()-.5)*540;final y=-80+rr.nextDouble()*190;beefFiber(c,Offset(x,y),100+rr.nextDouble()*150,22+rr.nextDouble()*15,(rr.nextDouble()-.5)*.55,heroA);}
     for(int i=0;i<10;i++){final a=i/9;onion(c,Offset(-250+a*500,-125+30*math.sin(i)),.8,(i-5)*.07,heroA);}
     for(int i=0;i<9;i++){cilantro(c,Offset(-270+i*67,-175+(i%2)*35),.8,(i-4)*.08,heroA);}c.restore();
   }
   final wipe=ease(seg(f,35,50));if(wipe>0&&wipe<1)lime(c,Offset(lerpD(1930,-250,wipe),lerpD(120,360,wipe)),lerpD(150,460,wipe),lerpD(-.7,1.1,wipe),1);
   final compA=ease(seg(f,43,52))*(1-ease(seg(f,97,106)));if(compA>.01){
     final ep=explode(0);tacoShell(c,Offset(960,lerpD(620,780,ep)),870,420,0,compA);
     for(int i=0;i<23;i++){final p=explode(2+i%5);final rr=math.Random(1200+i);final bx=960+(rr.nextDouble()-.5)*460;final by=lerpD(565,480+(rr.nextDouble()-.5)*80,p);beefFiber(c,Offset(bx,by),120+rr.nextDouble()*120,22+rr.nextDouble()*13,(rr.nextDouble()-.5)*.45,compA);}
     for(int i=0;i<8;i++){final p=explode(8+i%3);final x=lerpD(920+(i-4)*12,650+i*85,p);final y=lerpD(510,390+(i%2)*15,p);onion(c,Offset(x,y),.9,(i-4)*.08,compA);}
     for(int i=0;i<7;i++){final p=explode(11+i%3);final x=lerpD(930+(i-3)*14,680+i*92,p);final y=lerpD(495,295+(i%2)*20,p);cilantro(c,Offset(x,y),.9,(i-3)*.12,compA);}
     final lp=explode(15);lime(c,Offset(lerpD(930,900,lp),lerpD(455,165,lp)),lerpD(90,180,lp),lerpD(.15,-.12,lp),compA);
   }
 }

 void glass(Canvas c,Offset p,double sc,double alpha,{bool frozen=false,double rot=0}){
   c.save();c.translate(p.dx,p.dy);c.rotate(rot);c.scale(sc);
   c.drawOval(const Rect.fromLTWH(-210,330,420,42),shadow(.13*alpha,18));
   final bowl=Path()..moveTo(-220,-90)..quadraticBezierTo(-180,170,-65,205)..lineTo(-24,315)..lineTo(24,315)..lineTo(65,205)..quadraticBezierTo(180,170,220,-90)..close();
   c.drawPath(bowl,Paint()..shader=ui.Gradient.linear(const Offset(-220,-100),const Offset(220,280),[Colors.white.withOpacity(.24*alpha),const Color(0xFFE8FAE0).withOpacity(.12*alpha),Colors.white.withOpacity(.32*alpha)]));
   final liquid=Path()..moveTo(-202,-60)..quadraticBezierTo(-165,135,-58,168)..lineTo(58,168)..quadraticBezierTo(165,135,202,-60)..close();
   c.drawPath(liquid,Paint()..shader=ui.Gradient.linear(const Offset(-160,-60),const Offset(130,170),[const Color(0xFFF6E86A).withOpacity(.74*alpha),const Color(0xFFCFEF55).withOpacity(.67*alpha),const Color(0xFFF8F09B).withOpacity(.72*alpha)]));
   c.drawLine(const Offset(-215,-86),const Offset(215,-86),Paint()..color=Colors.white.withOpacity(.82*alpha)..strokeWidth=8..strokeCap=StrokeCap.round);
   for(int i=0;i<24;i++){final x=-205+i*18.0;c.drawCircle(Offset(x,-88+(i%2)*3),3+(i%3),Paint()..color=Colors.white.withOpacity(.95*alpha));}
   final stem=Paint()..shader=ui.Gradient.linear(const Offset(-30,190),const Offset(35,345),[Colors.white.withOpacity(.42*alpha),const Color(0xFFCAE6D0).withOpacity(.17*alpha),Colors.white.withOpacity(.48*alpha)]);
   c.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(-18,190,36,140),const Radius.circular(13)),stem);c.drawOval(const Rect.fromLTWH(-120,315,240,35),stem);
   for(int i=0;i<7;i++){final rr=math.Random(300+i);final x=-150+rr.nextDouble()*300;final y=-35+rr.nextDouble()*130;ice(c,Offset(x,y),42+rr.nextDouble()*18,(rr.nextDouble()-.5)*.4,alpha);}
   lime(c,const Offset(183,-58),75,.08,alpha);
   c.restore();
 }
 void ice(Canvas c,Offset p,double sz,double rot,double alpha){c.save();c.translate(p.dx,p.dy);c.rotate(rot);final r=RRect.fromRectAndRadius(Rect.fromCenter(center:Offset.zero,width:sz,height:sz),Radius.circular(sz*.15));c.drawRRect(r,Paint()..color=Colors.white.withOpacity(.16*alpha));c.drawRRect(r,Paint()..style=PaintingStyle.stroke..strokeWidth=3..color=Colors.white.withOpacity(.72*alpha));c.drawLine(Offset(-sz*.25,-sz*.22),Offset(sz*.25,sz*.24),Paint()..color=Colors.white.withOpacity(.32*alpha)..strokeWidth=2);c.restore();}
 void drawMargarita(Canvas c){
   final enter=outBack(seg(f,92,116));final heroA=enter*(1-ease(seg(f,120,134)));if(heroA>.01)glass(c,Offset(960,lerpD(1220,510,enter)),1.17,heroA,rot:lerpD(.08,-.02,enter));
   final splashA=ease(seg(f,118,136))*(1-ease(seg(f,156,173)));if(splashA>.01){glass(c,const Offset(960,535),1.05,splashA);final p=Path()..moveTo(700,410)..cubicTo(780,170,920,250,960,100)..cubicTo(1030,285,1170,165,1240,400);c.drawPath(p,Paint()..style=PaintingStyle.stroke..strokeWidth=38..strokeCap=StrokeCap.round..color=const Color(0xFFF3EB72).withOpacity(.56*splashA));
     for(int i=0;i<8;i++){final a=i*.8;final r=180+(i%3)*65.0;final pp=outCubic(seg(f,122+i,151+i));ice(c,Offset(960+math.cos(a)*r*pp,380+math.sin(a)*r*.65*pp),42+(i%3)*8,a*.3,splashA);}
     lime(c,Offset(lerpD(940,500,outCubic(seg(f,125,151))),lerpD(430,190,outCubic(seg(f,125,151)))),120,-.5,splashA);lime(c,Offset(lerpD(980,1370,outCubic(seg(f,129,154))),lerpD(430,260,outCubic(seg(f,129,154)))),105,.7,splashA);
   }
   final pair=outBack(seg(f,160,181));final out=1-ease(seg(f,190,203));if(pair*out>.01){glass(c,Offset(lerpD(800,650,pair),lerpD(760,520,pair)),.92,pair*out,rot:.02);glass(c,Offset(lerpD(1050,1260,pair),lerpD(760,500,pair)),.9,pair*out,frozen:true,rot:-.025);}
   final wipe=ease(seg(f,188,203));if(wipe>0&&wipe<1)lime(c,Offset(lerpD(1850,-280,wipe),lerpD(150,430,wipe)),lerpD(130,430,wipe),lerpD(-.4,1.25,wipe),1);
 }

 void strip(Canvas c,Offset p,double len,double thick,double rot,Color a,Color b,double alpha){c.save();c.translate(p.dx,p.dy);c.rotate(rot);final rr=RRect.fromRectAndRadius(Rect.fromCenter(center:Offset.zero,width:len,height:thick),Radius.circular(thick*.48));c.drawRRect(rr,Paint()..color=Colors.black.withOpacity(.15*alpha)..maskFilter=const ui.MaskFilter.blur(BlurStyle.normal,5));c.drawRRect(rr,Paint()..shader=ui.Gradient.linear(Offset(-len/2,0),Offset(len/2,0),[a.withOpacity(alpha),b.withOpacity(alpha),a.withOpacity(alpha)]));for(int i=-2;i<=2;i++)c.drawLine(Offset(-len*.28,i*3.2),Offset(len*.3,i*3.2),Paint()..color=Colors.white.withOpacity(.08*alpha)..strokeWidth=1);c.restore();}
 void shrimp(Canvas c,Offset p,double sc,double rot,double alpha){c.save();c.translate(p.dx,p.dy);c.rotate(rot);c.scale(sc);final path=Path()..moveTo(-65,-8)..cubicTo(-40,-78,65,-65,70,-5)..cubicTo(70,48,12,65,-18,32)..cubicTo(17,30,34,9,24,-10)..cubicTo(3,-39,-33,-28,-65,-8)..close();c.drawPath(path,Paint()..shader=ui.Gradient.linear(const Offset(-60,-50),const Offset(60,55),[const Color(0xFFFFB56B).withOpacity(alpha),const Color(0xFFE95A2A).withOpacity(alpha),const Color(0xFFFFC48B).withOpacity(alpha)]));c.drawPath(path,Paint()..style=PaintingStyle.stroke..strokeWidth=4..color=const Color(0xFF9D361F).withOpacity(.55*alpha));c.restore();}
 void skillet(Canvas c,double alpha){c.drawOval(const Rect.fromLTWH(280,690,1320,240),shadow(.22*alpha,25));final body=RRect.fromRectAndRadius(const Rect.fromLTWH(260,650,1390,260),const Radius.circular(120));c.drawRRect(body,Paint()..shader=ui.Gradient.linear(const Offset(260,650),const Offset(1650,900),[const Color(0xFF18191B).withOpacity(alpha),const Color(0xFF454548).withOpacity(alpha),const Color(0xFF111214).withOpacity(alpha)]));c.drawRRect(body,Paint()..style=PaintingStyle.stroke..strokeWidth=12..color=const Color(0xFF08090A).withOpacity(alpha));c.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(1540,720,330,70),const Radius.circular(35)),Paint()..color=const Color(0xFF151619).withOpacity(alpha));}
 void drawFajita(Canvas c){
   final sk=outBack(seg(f,190,214));final out=1-ease(seg(f,288,302));if(sk*out>.01){c.save();c.translate(0,lerpD(420,0,sk));skillet(c,sk*out);c.restore();}
   final specs=<Map<String,dynamic>>[
     {'x':500.0,'y':520.0,'type':'pepper','col':const Color(0xFF22A342),'rot':-.7}, {'x':720.0,'y':500.0,'type':'steak','rot':.4}, {'x':930.0,'y':520.0,'type':'chicken','rot':-.35}, {'x':1160.0,'y':490.0,'type':'shrimp','rot':.5}, {'x':1350.0,'y':540.0,'type':'pepper','col':const Color(0xFFE83B2D),'rot':-.3}, {'x':800.0,'y':610.0,'type':'pepper','col':const Color(0xFFF1B429),'rot':.2}, {'x':1080.0,'y':590.0,'type':'steak','rot':-.5}, {'x':1260.0,'y':620.0,'type':'shrimp','rot':-.2},
   ];
   for(int i=0;i<specs.length;i++){final land=outBack(seg(f,202+i*5,234+i*5));final a=land*out;if(a<=.01)continue;final x=lerpD(specs[i]['x']+(i.isEven?-230:210),specs[i]['x'],land);final y=lerpD(-330-i*38.0,specs[i]['y'],land);final rot=lerpD((specs[i]['rot'] as double)*2,specs[i]['rot'] as double,land);switch(specs[i]['type']){case 'shrimp':shrimp(c,Offset(x,y),.85,rot,a);break;case 'steak':strip(c,Offset(x,y),250,55,rot,const Color(0xFF4B1E14),const Color(0xFFC95B2A),a);break;case 'chicken':strip(c,Offset(x,y),260,52,rot,const Color(0xFFD98727),const Color(0xFFFFC05C),a);break;default:strip(c,Offset(x,y),280,38,rot,specs[i]['col'] as Color,(specs[i]['col'] as Color).withOpacity(.7),a);}}
   final steam=ease(seg(f,225,245))*(1-ease(seg(f,282,300)));if(steam>.01){final p=Paint()..style=PaintingStyle.stroke..strokeWidth=9..strokeCap=StrokeCap.round..color=Colors.white.withOpacity(.12*steam)..maskFilter=const ui.MaskFilter.blur(BlurStyle.normal,14);for(int i=0;i<6;i++){final x=520+i*170.0+20*math.sin(f*.04+i);final path=Path()..moveTo(x,690)..cubicTo(x-60,600,x+70,525,x+10,420);c.drawPath(path,p);}}
   final wipe=ease(seg(f,287,302));if(wipe>0&&wipe<1)strip(c,Offset(lerpD(1860,-320,wipe),lerpD(260,470,wipe)),lerpD(280,840,wipe),80,lerpD(-.8,1.2,wipe),const Color(0xFFE73A2C),const Color(0xFFFFB02D),1);
 }

 void churro(Canvas c,Offset p,double len,double thick,double rot,double alpha){c.save();c.translate(p.dx,p.dy);c.rotate(rot);final path=Path()..moveTo(-len/2,0)..cubicTo(-len*.25,-25,len*.22,20,len/2,0);c.drawPath(path,Paint()..color=Colors.black.withOpacity(.18*alpha)..strokeWidth=thick+16..strokeCap=StrokeCap.round..maskFilter=const ui.MaskFilter.blur(BlurStyle.normal,8));c.drawPath(path,Paint()..shader=ui.Gradient.linear(Offset(-len/2,0),Offset(len/2,0),[const Color(0xFFC9660A).withOpacity(alpha),const Color(0xFFFFB138).withOpacity(alpha),const Color(0xFFC45C05).withOpacity(alpha)])..strokeWidth=thick..strokeCap=StrokeCap.round);for(int i=-2;i<=2;i++){c.drawPath(path,Paint()..color=(i.isEven?const Color(0xFFFFC66D):const Color(0xFF9A4102)).withOpacity(.36*alpha)..strokeWidth=4..strokeCap=StrokeCap.round);c.translate(0,2);}final rr=math.Random(499);for(int i=0;i<30;i++){final x=(rr.nextDouble()-.5)*len*.9;final y=(rr.nextDouble()-.5)*thick*.7;c.drawCircle(Offset(x,y),1.3+rr.nextDouble()*2.2,Paint()..color=Colors.white.withOpacity(.62*alpha));}c.restore();}
 void chocolate(Canvas c,double a){final wig=math.sin(f*.08)*26;final p=Paint()..style=PaintingStyle.stroke..strokeCap=StrokeCap.round..strokeWidth=26..shader=ui.Gradient.linear(const Offset(250,300),const Offset(1700,750),[const Color(0xFF2A0D07).withOpacity(.9*a),const Color(0xFF6B250B).withOpacity(.9*a)]);final q=Path()..moveTo(250,720)..cubicTo(500,390+wig,780,730-wig,1020,370)..cubicTo(1240,80+wig,1460,490,1700,270);c.drawPath(q,p);}
 void drawChurros(Canvas c){final out=1-ease(seg(f,340,355));final positions=[const Offset(560,390),const Offset(950,520),const Offset(1260,370)];final starts=[const Offset(-500,300),const Offset(2200,240),const Offset(850,-420)];for(int i=0;i<3;i++){final e=outBack(seg(f,290+i*6,321+i*4));if(e*out>.01)churro(c,Offset(lerpD(starts[i].dx,positions[i].dx,e),lerpD(starts[i].dy,positions[i].dy,e)),720,80,lerpD([-1.0,.8,1.2][i],[-.35,.12,.5][i],e),e*out);}final ch=ease(seg(f,302,331))*(1-ease(seg(f,346,359)));if(ch>.01)chocolate(c,ch);final hero=ease(seg(f,336,350))*(1-ease(seg(f,352,371)));if(hero>.01){churro(c,const Offset(720,430),800,86,-.34,hero);churro(c,const Offset(1000,520),830,88,.08,hero);churro(c,const Offset(1260,400),750,82,.43,hero);} }
 void drawClose(Canvas c){final p=ease(seg(f,360,389));lime(c,Offset(lerpD(250,-180,p),lerpD(830,940,p)),110,lerpD(.2,-1.1,p),.45*(1-p));}
 @override bool shouldRepaint(covariant FoodMotionPainter old)=>old.f!=f;
}
