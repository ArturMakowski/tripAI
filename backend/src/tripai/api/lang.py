"""Per-request language: `?lang=` or `Accept-Language` sets it for the whole request; a `lang`
field in a JSON body overrides it inside the endpoint (`use_lang`). Responses say which language
they were written in (`Content-Language`)."""

from urllib.parse import parse_qs

from tripai import i18n


class LanguageMiddleware:
    """Pure ASGI middleware (keeps the ContextVar in the request's own task)."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        query = parse_qs(scope.get("query_string", b"").decode("latin-1"))
        lang = i18n.resolve((query.get("lang") or [None])[0], headers.get("accept-language"))

        async def send_with_language(message) -> None:
            if message["type"] == "http.response.start":
                # the endpoint may have switched language from a body `lang`: report that one
                message.setdefault("headers", [])
                message["headers"].append((b"content-language", i18n.current().encode()))
            await send(message)

        with i18n.using(lang):
            await self.app(scope, receive, send_with_language)


def use_lang(lang: str | None) -> i18n.Lang:
    """A body `lang` ('pl'/'en'/'pl-PL') wins over the header for the rest of this request."""
    if (lg := i18n.normalise(lang)) is not None:
        i18n.set_current(lg)
    return i18n.current()
