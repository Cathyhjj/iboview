#include <algorithm>
#include <cassert>
#include <cstddef>
#include <iostream>
#include <vector>

using std::size_t;
using FFrameIndexList = std::vector<int>;

#include "frame_functions.inc"

static void CheckUp(FFrameIndexList all, FFrameIndexList const &selected,
                    FFrameIndexList const &expected)
{
   MoveSelectedUp(all, selected);
   assert(all == expected);
}

static void CheckDown(FFrameIndexList all, FFrameIndexList selected,
                      FFrameIndexList const &expected)
{
   InvertOrder(all, selected);
   MoveSelectedUp(all, selected);
   InvertOrder(all, selected);
   assert(all == expected);
}

int main()
{
   CheckUp({}, {}, {});
   CheckUp({0, 1, 2}, {}, {0, 1, 2});
   CheckUp({0}, {0}, {0});
   CheckUp({0, 1, 2}, {0}, {0, 1, 2});
   CheckUp({0, 1, 2}, {0, 1}, {0, 1, 2});
   CheckUp({0, 1, 2}, {0, 1, 2}, {0, 1, 2});
   CheckUp({0, 1, 2}, {1}, {1, 0, 2});
   CheckUp({0, 1, 2}, {2}, {0, 2, 1});
   CheckUp({0, 1, 2, 3, 4, 5}, {0, 1, 4, 5}, {0, 1, 2, 4, 5, 3});
   CheckUp({0, 1, 2, 3, 4, 5}, {1, 3}, {1, 0, 3, 2, 4, 5});
   CheckDown({0, 1, 2}, {2}, {0, 1, 2});
   CheckDown({0, 1, 2}, {0, 1, 2}, {0, 1, 2});
   CheckDown({0, 1, 2}, {1}, {0, 2, 1});
   CheckDown({0, 1, 2, 3, 4, 5}, {0, 1, 4, 5}, {2, 0, 1, 3, 4, 5});
   std::cout << "PASS: 14 frame movement regressions\n";
}
