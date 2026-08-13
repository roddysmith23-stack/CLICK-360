import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:el_charros_motion_render/motion_frame.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('render deterministic Flutter motion-frame shard', (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(designW, designH));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final startFrame = int.parse(Platform.environment['START_FRAME'] ?? '0');
    final endFrame = int.parse(Platform.environment['END_FRAME'] ?? '${totalFrames - 1}');
    if (startFrame < 0 || endFrame >= totalFrames || startFrame > endFrame) {
      throw StateError('Invalid frame shard $startFrame..$endFrame');
    }

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

    final dir = Directory('build/render_frames');
    if (dir.existsSync()) dir.deleteSync(recursive: true);
    dir.createSync(recursive: true);

    const renderScale = 4.0 / 3.0; // 1920x1080 design -> 2560x1440 source frames
    for (var frame = startFrame; frame <= endFrame; frame++) {
      await tester.pumpWidget(wrap(frame));
      await tester.pump();
      final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(boundaryKey));
      final ui.Image image = await boundary.toImage(pixelRatio: renderScale);
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      if (data == null) throw StateError('PNG encode returned null at frame $frame');
      final bytes = data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
      final file = File('build/render_frames/frame_${frame.toString().padLeft(4, '0')}.png');
      await file.writeAsBytes(bytes, flush: false);
      image.dispose();
      if ((frame - startFrame) % 20 == 0) {
        // ignore: avoid_print
        print('Rendered Flutter frame $frame ($startFrame..$endFrame)');
      }
    }

    expect(File('build/render_frames/frame_${endFrame.toString().padLeft(4, '0')}.png').existsSync(), isTrue);
  }, timeout: const Timeout(Duration(minutes: 18)));
}
