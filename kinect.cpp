
#include <stdio.h>
#include <string.h>
#include <math.h>

#include <opencv2/opencv.hpp>
#include <opencv2/core/core.hpp>

#include <libfreenect.h>
#include <pthread.h>
#include <napi.h>
#include <vector>
#include <thread>

#define KINECT_ADDR "A00362A18995043A"
#define FREENECTOPENCV_DEPTH_DEPTH 1
#define FREENECTOPENCV_DEPTH_WIDTH 640
#define FREENECTOPENCV_DEPTH_HEIGHT 480

freenect_context *f_ctx;
freenect_device *f_dev;
cv::Mat depthimg, background;
int bgimgs = 0;
pthread_mutex_t mutex_depth = PTHREAD_MUTEX_INITIALIZER;

void depth_cb(freenect_device *dev, void *depth, uint32_t timestamp) {
    cv::Mat tmp = cv::Mat(FREENECTOPENCV_DEPTH_WIDTH,FREENECTOPENCV_DEPTH_HEIGHT, CV_16UC1, depth);

    pthread_mutex_lock( &mutex_depth );
    memcpy(depthimg.data, tmp.data, FREENECTOPENCV_DEPTH_WIDTH * (FREENECTOPENCV_DEPTH_HEIGHT*2));
    
    // Rotate Image
    cv::Point2f src_center(depthimg.cols/2.0F, depthimg.rows/2.0F);
    cv::Mat rot_mat = cv::getRotationMatrix2D(src_center, 180, 1.0);
    cv::warpAffine(depthimg, depthimg, rot_mat, depthimg.size());

    // Background-Subtraction
    // if(bgimgs > 100) {
    //     for(int x = 0; x < depthimg.cols; x++) {
    //         for(int y = 0; y < depthimg.rows; y++) {
    //             if(std::abs(depthimg.at<ushort>(y,x) - background.at<ushort>(y,x)) < 5) {
    //                 depthimg.at<ushort>(y,x) = USHRT_MAX;
    //             }
    //         }
    //     }
    // } else {
    //     if(bgimgs > 50) {
    //         for(int x = 0; x < depthimg.cols; x++) {
    //             for(int y = 0; y < depthimg.rows; y++) {
    //                 background.at<ushort>(y,x) = std::round((depthimg.at<ushort>(y,x) + background.at<ushort>(y,x)) / 2);
    //             }
    //         }
    //     }
    //     bgimgs++;
    // }

    pthread_mutex_unlock( &mutex_depth );
}

void initKinect(void) {
    depthimg = cv::Mat(FREENECTOPENCV_DEPTH_HEIGHT, FREENECTOPENCV_DEPTH_WIDTH, CV_16UC1);
    background = cv::Mat(FREENECTOPENCV_DEPTH_HEIGHT, FREENECTOPENCV_DEPTH_WIDTH, CV_16UC1);

    if (freenect_init(&f_ctx, NULL) < 0) {
        printf("freenect_init() failed\n");
    }

    freenect_select_subdevices(f_ctx, FREENECT_DEVICE_CAMERA);

    if (freenect_open_device_by_camera_serial(f_ctx, &f_dev, KINECT_ADDR) < 0) {
        printf("Could not open device 1\n");
    }

    freenect_set_depth_callback(f_dev, depth_cb);
    freenect_start_depth(f_dev);

    while(freenect_process_events(f_ctx) >= 0);
}

class KinectImageWorker : public Napi::AsyncWorker {
    public:
        KinectImageWorker(Napi::Function& callback)
            : Napi::AsyncWorker(callback) {}

        ~KinectImageWorker() {}
        void Execute() {
            initKinect();
        }
};

std::vector<uchar> buf;

void GetFrame(const Napi::CallbackInfo& info) {
    cv::Mat depthimg8 = cv::Mat(FREENECTOPENCV_DEPTH_HEIGHT, FREENECTOPENCV_DEPTH_WIDTH, CV_8UC1);
    
    pthread_mutex_lock( &mutex_depth );
    depthimg.convertTo(depthimg8, CV_8UC1, 1.0f / 4.0f);
    pthread_mutex_unlock( &mutex_depth );

    cv::imencode(".png", depthimg8, buf);
    Napi::Buffer<uchar> data = Napi::Buffer<uchar>::New(info.Env(), buf.data(), buf.size());
    buf.clear();

	int length = depthimg.cols * depthimg.rows;
	Napi::Array arr = Napi::Array::New(info.Env(), length);
	int i = 0;
	
	for (int y = 0; y < depthimg.rows; y++) {
		for (int x = 0; x < depthimg.cols; x++) {
			napi_value val;
			ushort pix = (ushort) depthimg.at<ushort>(y,x);
			napi_create_uint32(info.Env(), pix, &val);
			napi_set_element(info.Env(), arr, i, val);
			i++;
		}
	}

    Napi::Function cb = info[0].As<Napi::Function>();
    cb.Call(info.Env().Global(), { data, arr });
}

Napi::Value InitCamera(const Napi::CallbackInfo& info) {
    Napi::Function cb = info[0].As<Napi::Function>();
    KinectImageWorker* wk = new KinectImageWorker(cb);
    wk->Queue();
    return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "init"), Napi::Function::New(env, InitCamera));
    exports.Set(Napi::String::New(env, "getFrame"), Napi::Function::New(env, GetFrame));
    return exports;
}

NODE_API_MODULE(kinect, Init)
