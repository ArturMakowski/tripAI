"""Generate a VAPID key pair for web push: `uv run python -m tripai.notify.vapid`.

Prints env lines to paste into .env / Railway variables. The private key is a secret.
"""

import argparse

from tripai.notify.push import DEFAULT_SUBJECT, generate_vapid_keys


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--subject", default=DEFAULT_SUBJECT, help="mailto: or https: contact")
    args = parser.parse_args(argv)
    public, private = generate_vapid_keys()
    print(f"VAPID_PUBLIC_KEY={public}")
    print(f"VAPID_PRIVATE_KEY={private}")
    print(f"VAPID_SUBJECT={args.subject}")


if __name__ == "__main__":
    main()
