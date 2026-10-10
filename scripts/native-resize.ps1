param([int]$X, [int]$Y, [double]$DpiScale, [long]$Window)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PetTestMouse {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
}
'@
$null = [PetTestMouse]::SetThreadDpiAwarenessContext([IntPtr](-4))
if ([PetTestMouse]::GetForegroundWindow().ToInt64() -ne $Window) { throw 'Test window lost focus' }
$original = New-Object PetTestMouse+Point
$null = [PetTestMouse]::GetCursorPos([ref]$original)
try {
  $null = [PetTestMouse]::SetCursorPos($X, $Y)
  Start-Sleep -Milliseconds 80
  [PetTestMouse]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 240
  $null = [PetTestMouse]::SetCursorPos($X - [int](20 * $DpiScale), $Y - [int](30 * $DpiScale))
  Start-Sleep -Milliseconds 160
  $null = [PetTestMouse]::SetCursorPos($X - [int](36 * $DpiScale), $Y - [int](48 * $DpiScale))
  Start-Sleep -Milliseconds 160
} finally {
  [PetTestMouse]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  $null = [PetTestMouse]::SetCursorPos($original.X, $original.Y)
}
