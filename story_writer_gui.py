"""Independent story-writing window, using the main tool's maintained Script UI."""
import tkinter as tk
from veo3_gui import Veo3LauncherGUI


def main():
    try:
        from ctypes import windll
        windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass
    root = tk.Tk()
    Veo3LauncherGUI(root, script_only=True)
    root.mainloop()


if __name__ == "__main__":
    main()
