from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'app.js'
text = path.read_text(encoding='utf-8')
old = """      $('#quickLabelConfirm').onclick = () => {
        closeModal();
        resolve({
          confirmed:true,
          quantity:Math.max(1, Number($('#quickLabelQuantity')?.value || 1)),
          startSlot:Math.max(1, Number($('#quickLabelStartSlot')?.value || 1))
        });
      };"""
new = """      $('#quickLabelConfirm').onclick = () => {
        const confirmedQuantity = Math.max(1, Number($('#quickLabelQuantity')?.value || 1));
        const confirmedStartSlot = Math.max(1, Number($('#quickLabelStartSlot')?.value || 1));
        closeModal();
        resolve({
          confirmed:true,
          quantity:confirmedQuantity,
          startSlot:confirmedStartSlot
        });
      };"""
count = text.count(old)
if count != 1:
    raise SystemExit(f'quick print confirm anchor expected once, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('CLICK360_R30_QUICK_CONFIRM_FIX: APPLIED')
