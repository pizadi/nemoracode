#pragma once
namespace geo {
struct Shape {
    virtual int area() const;
};
struct Square : Shape {
    int area() const;
};
}
