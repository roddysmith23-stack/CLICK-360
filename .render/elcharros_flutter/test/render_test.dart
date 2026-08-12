import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:el_charros_motion_render/motion_frame.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('render 390 deterministic motion frames', (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(designW, designH));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    const boundaryKey = ValueKey<String>('capture-boundary');
    Widget wrap(int frame) => Directionality(
      textDirection: TextDirection.ltr,
      child: ColoredBox(
        color: Colors.black,
        child: Center(
          child: RepaintBoundary(
            key: boundaryKey,
            child: MotionFrame(frameIndex: frame),
          ),
        ),
      ),
    );

    await tester.pumpWidget(wrap(0));
    await tester.pumpAndSettle();
    final context = tester.element(find.byType(MotionFrame));
    for (final name in motionAssets) {
      await precacheImage(AssetImage('assets/$name.webp'), context);
    }
    await tester.pumpAndSettle();

    final dir = Directory('build/render_frames');
    if (dir.existsSync()) dir.deleteSync(recursive: true);
    dir.createSync(recursive: true);

    for (var frame = 0; frame < totalFrames; frame++) {
      await tester.pumpWidget(wrap(frame));
      await tester.pump();
      final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(boundaryKey));
      final ui.Image image = await boundary.toImage(pixelRatio: 1.0);
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      if (data == null) throw StateError('PNG encode returned null at frame $frame');
      final bytes = data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
      final file = File('build/render_frames/frame_${frame.toString().padLeft(4, '0')}.png');
      await file.writeAsBytes(bytes, flush: false);
      image.dispose();
      if (frame % 30 == 0) {
        // ignore: avoid_print
        print('Rendered frame $frame / ${totalFrames - 1}');
      }
    }
    expect(File('build/render_frames/frame_0389.png').existsSync(), isTrue);
  }, timeout: const Timeout(Duration(minutes: 35)));
}
