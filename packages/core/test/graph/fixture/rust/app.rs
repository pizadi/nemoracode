mod util;

pub trait Shape {
    fn area(&self) -> i32;
}

pub struct Square;

impl Shape for Square {
    fn area(&self) -> i32 {
        0
    }
}
