# {{TITLE}}

Paper-Plugin (Paper-API {{PAPER_API}}, Java {{JAVA_RELEASE}}, Gradle {{GRADLE_VERSION}}) – angelegt mit Hostwerk.

## Bauen und live einspielen

```
gradlew.bat deployHostwerk      (Windows)
./gradlew deployHostwerk        (Linux)
```

Baut die JAR (`build/libs/`) und spielt sie per Hostwerk in den laufenden Server ein – ohne Neustart,
wenn es sicher geht. Alternativ einfach `gradlew build`: Hostwerk beobachtet den Ordner und übernimmt
jede neue JAR automatisch.

Einstellungen dazu: Hostwerk → Minecraft → dein Server → Plugins → „Plugin-Live-Update“.

## Aufbau

- `src/main/java/…/{{CLASS}}.java` – Hauptklasse (Befehl `/hello`, Begrüßung beim Betreten)
- `src/main/resources/plugin.yml` – Name, Version, Befehle
- `src/main/resources/config.yml` – Einstellungen
