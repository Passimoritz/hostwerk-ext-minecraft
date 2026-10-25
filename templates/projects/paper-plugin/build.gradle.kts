plugins {
    java
}

group = "de.hostwerk.{{PKG}}"
version = "1.0.0"

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:{{PAPER_API}}")
}

java {
    toolchain.languageVersion = JavaLanguageVersion.of({{JAVA_RELEASE}})
}

tasks.processResources {
    // Version als Eingabe – sonst baut Gradle die plugin.yml nach einer Versionsänderung nicht neu
    inputs.property("version", project.version)
    filteringCharset = "UTF-8"
    filesMatching("plugin.yml") { expand("version" to project.version) }
}

tasks.jar {
    archiveFileName = "{{CLASS}}-${project.version}.jar"
}
