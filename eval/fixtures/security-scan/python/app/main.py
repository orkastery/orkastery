import os
import subprocess
import sys

import yaml
from flask import Flask, request

app = Flask(__name__)


@app.route("/run")
def run():
    # Command injection: user input reaches a shell.
    subprocess.call("ls " + request.args.get("dir"), shell=True)
    return "ok"


if __name__ == "__main__":
    app.run(debug=True)
