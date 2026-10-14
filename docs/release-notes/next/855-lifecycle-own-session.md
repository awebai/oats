## Changed

- A stop, retire or start runs in a process session of its own, so neither closing the Desktop nor interrupting the terminal that started it interrupts it. When a stop or retire takes longer than ten minutes, the Desktop stops waiting and says the result is not confirmed; the command keeps running, and Check again reads its result. When a start or restart takes longer than 60 seconds, the Desktop stops waiting and says the start is not confirmed; the start keeps running, and the roster shows its result. Another stop or retire asked meanwhile names the one still running.
