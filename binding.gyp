{
    "variables": {
        "freenect_libname%":"freenect"
    },
    "targets": [
        {
            "target_name": "kinect",
            "sources": [
                "kinect.cpp"
            ],

            "libraries": [
                "<!@(pkg-config opencv --libs)",
                "<!@(pkg-config libfreenect --libs)"
            ],
            "include_dirs": [
                "<!@(node -p \"require('node-addon-api').include\")",
                "<!@(pkg-config opencv --cflags)",
                "<!@(pkg-config libfreenect --cflags)",
                # "/usr/local/include/lib<(freenect_libname)",
                # "/usr/local/include/libusb-1.0"
            ],
            "library_dirs": [
                "/usr/local/lib"
            ],
            "dependencies": [
                "<!(node -p \"require('node-addon-api').gyp\")"
            ],
            "ldflags": [
                "-l<(freenect_libname)",
            ],
            "cflags": [
                "-fmessage-length=0",
                "<!@(pkg-config opencv --cflags)",
                "<!@(pkg-config libfreenect --cflags)"
            ],

            # "include_dirs": [
            #     "<!@(node -p \"require('node-addon-api').include\")"
            #     # "/usr/include/libusb-1.0"
            #     # "/usr/include/libfreenect"
            #     # "/usr/local/include/libfreenect"
            # ],
            # "library_dirs": [
            #     "/usr/local/lib"
            # ],
            # "dependencies": [
            #     "<!(node -p \"require('node-addon-api').gyp\")"
            # ],
            # "cflags": [
            #     "-fno-exceptions",
            #     "<!@(pkg-config opencv --cflags)",
            #     "-fmessage-length=0",
            #     "-lfreenect"
            #     # "-lpthread",
            # ],


            "cflags!": ["-fno-exceptions", "-fno-rtti"],
            "cflags_cc!": ["-fno-exceptions", "-fno-rtti"],
            "defines": ["NAPI_CPP_EXCEPTIONS"],
        }
    ]
}
