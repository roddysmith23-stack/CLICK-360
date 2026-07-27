# Universal Label Canvas: Physical Smoke

This procedure uses synthetic test content only. Do not place customer data,
real sales records or customer identities in the test label.

## Provisional profile

- Label: 40 x 60 mm
- Columns: 2
- DPI: 203
- Total media width, central gap and pitch: measure on the actual support
- Status: provisional until both positions scan and align

## Steps

1. Measure total media width, one label width and height, the centre gap and
   pitch. Enter total width, label dimensions, gap and pitch in the paper and
   **Medición y calibración** fields.
2. Save a named printer-paper profile. It is selected per business and device.
3. Print the calibration sheet for one row. Compare its outer edges with the
   physical support.
4. Adjust X and Y offsets, then print one row again. Use scale only for a
   measured printer scaling deviation. Do not use zoom to solve a physical
   offset.
5. Print two labels and scan both QR codes. Confirm left and right positions
   independently.
6. Start from the second slot and print exactly one label. Confirm the first
   slot remains unused.
7. Save as PDF and compare the first page with the canvas preview.
8. Restart the PWA, reopen the same business and device, and verify that the
   profile is selected. Switch business and confirm the profile is not reused.

## Pass criteria

- Both QR codes scan.
- Edges, gap and pitch match the measured support.
- First and second positions align independently.
- Exact quantity and starting slot match the physical output.
- Preview, PDF and system-print output use the same visible content.

If a check fails, keep the profile provisional, record the measured deviation,
adjust only calibration fields, and repeat the synthetic test. Do not claim
hardware certification from browser QA alone.
