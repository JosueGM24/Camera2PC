# Toque — inyector de entrada para Windows.
# Lee comandos por stdin (una línea por evento) y los convierte en
# entradas reales de mouse/teclado con SendInput (user32.dll).
#
#   m <dx> <dy>      mover mouse (relativo)
#   s <dx> <dy>      scroll (unidades de rueda)
#   d <0|1|2>        botón abajo (izq|der|medio)
#   u <0|1|2>        botón arriba
#   k <vk> <1|0>     tecla virtual abajo/arriba
#   t <base64utf8>   escribir texto unicode

$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class RemoteInput
{
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public InputUnion U; }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    const uint MOVE = 0x0001, LDOWN = 0x0002, LUP = 0x0004, RDOWN = 0x0008, RUP = 0x0010,
               MDOWN = 0x0020, MUP = 0x0040, WHEEL = 0x0800, HWHEEL = 0x1000;
    const uint KEYUP = 0x0002, UNICODE = 0x0004;

    static void Mouse(int dx, int dy, uint data, uint flags)
    {
        INPUT[] i = new INPUT[1];
        i[0].type = 0;
        i[0].U.mi.dx = dx; i[0].U.mi.dy = dy;
        i[0].U.mi.mouseData = data; i[0].U.mi.dwFlags = flags;
        SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
    }

    static void Key(ushort vk, bool down)
    {
        INPUT[] i = new INPUT[1];
        i[0].type = 1;
        i[0].U.ki.wVk = vk;
        i[0].U.ki.dwFlags = down ? 0u : KEYUP;
        SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
    }

    static void Char(char c)
    {
        INPUT[] i = new INPUT[2];
        i[0].type = 1; i[0].U.ki.wScan = c; i[0].U.ki.dwFlags = UNICODE;
        i[1].type = 1; i[1].U.ki.wScan = c; i[1].U.ki.dwFlags = UNICODE | KEYUP;
        SendInput(2, i, Marshal.SizeOf(typeof(INPUT)));
    }

    static uint BtnFlag(string b, bool down)
    {
        if (b == "1") return down ? RDOWN : RUP;
        if (b == "2") return down ? MDOWN : MUP;
        return down ? LDOWN : LUP;
    }

    public static void Process(string line)
    {
        string[] p = line.Split(' ');
        switch (p[0])
        {
            case "m": Mouse(int.Parse(p[1]), int.Parse(p[2]), 0, MOVE); break;
            case "s":
                int sx = int.Parse(p[1]), sy = int.Parse(p[2]);
                if (sy != 0) Mouse(0, 0, unchecked((uint)sy), WHEEL);
                if (sx != 0) Mouse(0, 0, unchecked((uint)sx), HWHEEL);
                break;
            case "d": Mouse(0, 0, 0, BtnFlag(p[1], true)); break;
            case "u": Mouse(0, 0, 0, BtnFlag(p[1], false)); break;
            case "k": Key((ushort)int.Parse(p[1]), p[2] == "1"); break;
            case "t":
                string s = Encoding.UTF8.GetString(Convert.FromBase64String(p[1]));
                foreach (char c in s) Char(c);
                break;
        }
    }
}
'@

Add-Type -TypeDefinition $src -Language CSharp
[Console]::WriteLine("ready")

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Length -eq 0) { continue }
    try { [RemoteInput]::Process($line) } catch {}
}
