plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    id("com.google.gms.google-services")
}

android {
    namespace = "com.pricealert.sound"
    compileSdk = 34

    defaultConfig {
        // Must match the package_name in google-services.json (Firebase project alert-87199).
        applicationId = "alertapp.akhalteke.com"
        minSdk = 26
        targetSdk = 34
        versionCode = 6
        versionName = "1.5"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.lifecycle.service)
    implementation(libs.kotlinx.coroutines)
    // FCM is optional: include it, but the app works with polling alone.
    // If you don't use Firebase, comment this line out and remove google-services plugin/json.
    implementation(libs.firebase.messaging)
    implementation(libs.gms.base)
}
